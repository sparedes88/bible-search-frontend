import React, { useState, useEffect, useRef } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { db } from '../firebase';
import { collection, query, getDocs, where, orderBy, addDoc, updateDoc, serverTimestamp, deleteDoc, increment, doc, getDoc } from 'firebase/firestore';
import { useParams, useNavigate } from 'react-router-dom';
import ChurchHeader from './ChurchHeader';
import ReactMarkdown from 'react-markdown';
import { prompts, getButtonLabel } from './prompts';
import commonStyles from '../pages/commonStyles';

const additionalStyles = {
  progressContainer: {
    width: '100%',
    height: '4px',
    backgroundColor: '#E2E8F0',
    borderRadius: '2px',
    marginBottom: '10px',
    overflow: 'hidden',
  },
  progressBar: {
    height: '100%',
    backgroundColor: '#4F46E5',
    borderRadius: '2px',
    transition: 'width 0.3s ease',
  },
  progressText: {
    fontSize: '14px',
    color: '#4F46E5',
    fontWeight: 500,
    textAlign: 'right',
    marginBottom: '10px',
  },
  disabledOverlay: {
    position: 'relative',
    width: '100%',
    marginBottom: '20px',
  },
  progressOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    backgroundColor: 'rgba(255, 255, 255, 0.9)',
    padding: '12px',
    borderRadius: '6px',
    zIndex: 10,
    display: 'flex',
    flexDirection: 'column',
    gap: '8px',
  }
};

const messageStyles = {
  user: {
    backgroundColor: '#f2fcf3',
    textAlign: "left",
    borderRadius: '12px',
    padding: '16px',
    border: '1px solid #85d688',
  },
  assistant: {
    backgroundColor: '#EEF2FF',
    textAlign: "left",
    borderRadius: '12px',
    padding: '16px',
    border: '1px solid #C7D2FE',
  },
  header: {
    userHeader: {
      color: '#4B5563',
      fontWeight: '500',
      marginBottom: '8px',
      display: 'flex',
      alignItems: 'center',
      gap: '8px',
    },
    assistantHeader: {
      color: '#4338CA',
      fontWeight: '500',
      marginBottom: '15px',
      display: 'flex',
      alignItems: 'center',
      gap: '8px',
    }
  }
};

const ThinkingAnimation = () => (
  <div className="thinking-animation">
    <div className="thinking-bubble">
      <div className="dots">
        <span></span>
        <span></span>
      </div>
      <div className="thinking-text">Formulando respuesta...</div>
    </div>
    <div className="ai-skeleton">
      <div className="skeleton-line w-3/4"></div>
      <div className="skeleton-line w-1/2"></div>
      <div className="skeleton-line w-full"></div>
      <div className="skeleton-line w-2/3"></div>
      <div className="skeleton-block"></div>
    </div>
  </div>
);

// Update the CopyButton component styling
const CopyButton = ({ text }) => {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error('Failed to copy text:', err);
    }
  };

  return (
    <button
      onClick={handleCopy}
      style={{ ...commonStyles.indigoButton, margin: "0" }}
      title="Copiar respuesta"
    >
      {copied ? '✓ Copiado' : '📋 Copiar'}
    </button>
  );
};

const TypingAnimation = ({ text = '', isTyping }) => {
  const [displayedText, setDisplayedText] = useState('');
  const [currentIndex, setCurrentIndex] = useState(0);
  const [isDone, setIsDone] = useState(false);

  useEffect(() => {
    setDisplayedText('');
    setCurrentIndex(0);
    setIsDone(false);
  }, [text]);

  useEffect(() => {
    if (!text || currentIndex >= text.length) {
      setIsDone(true);
      return;
    }

    const timer = setTimeout(() => {
      setDisplayedText(text.substring(0, currentIndex + 1));
      setCurrentIndex(c => c + 1);
    }, 15);

    return () => clearTimeout(timer);
  }, [currentIndex, text]);

  // Notify parent when typing is complete
  useEffect(() => {
    if (isDone) {
      isTyping(false);
    } else {
      isTyping(true);
    }
  }, [isDone, isTyping]);

  return (
    <div className="typing-animation">
      <ReactMarkdown>{displayedText}</ReactMarkdown>
    </div>
  );
};

const GPT4_INPUT_COST = 0.03 / 1000;
const GPT4_OUTPUT_COST = 0.06 / 1000;

const calculateTokenCost = (text, isOutput = false) => {
  const tokens = Math.ceil(text.length / 3.5);
  const rate = isOutput ? GPT4_OUTPUT_COST : GPT4_INPUT_COST;
  return tokens * rate;
};

const AsistentePastoral = () => {
  const navigate = useNavigate();
  const { id } = useParams();
  const [tema, setTema] = useState('');
  const [messages, setMessages] = useState([]);
  const [userInput, setUserInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [progress, setProgress] = useState(0);
  const chatEndRef = useRef(null);
  const [conversations, setConversations] = useState([]);
  const [currentConversationId, setCurrentConversationId] = useState(null);
  const { user } = useAuth();
  const [requestQueue, setRequestQueue] = useState([]);
  const [isProcessingQueue, setIsProcessingQueue] = useState(false);
  const [isTypingResponse, setIsTypingResponse] = useState(false);
  const [showHistory, setShowHistory] = useState(false);

  useEffect(() => {
    if (tema) {
      setMessages([{ role: 'assistant', content: prompts[tema] }]);
    }
  }, [tema]);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  useEffect(() => {
    if (user && id) {
      fetchConversations();
    }
  }, [user, id]);

  const fetchConversations = async () => {
    try {
      const q = query(
        collection(db, `churches/${id}/users/${user.uid}/conversations`),
        orderBy('createdAt', 'desc')
      );
      const snapshot = await getDocs(q);
      const convos = snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data(),
      }));
      setConversations(convos);
    } catch (error) {
      console.error('Error fetching conversations:', error);
    }
  };

  const startNewConversation = async () => {
    setCurrentConversationId(null);
    setMessages([{ role: 'assistant', content: prompts[tema] }]);
    setUserInput('');
  };

  const handleBoton = (tipo) => {
    setTema(tipo);
    startNewConversation();
  };

  useEffect(() => {
    const processQueue = async () => {
      if (requestQueue.length > 0 && !isProcessingQueue) {
        setIsProcessingQueue(true);
        const nextRequest = requestQueue[0];
        await processRequest(nextRequest);
        setRequestQueue(prev => prev.slice(1));
        setIsProcessingQueue(false);
      }
    };

    processQueue();
  }, [requestQueue, isProcessingQueue]);

  const processRequest = async (request) => {
    setLoading(true);
    setProgress(0);

    const progressInterval = setInterval(() => {
      setProgress(prev => {
        if (prev >= 90) {
          return prev + 0.1; // Slower progress after 90%
        }
        return Math.min(prev + 2, 90);
      });
    }, 100);

    try {
      const newMessages = [...request.messages, { role: 'user', content: request.input }];
      setMessages(newMessages);
      setUserInput('');

      const apiKey = process.env.REACT_APP_OPENAI_API_KEY;

      if (!apiKey) {
        throw new Error('API key not configured');
      }

      let conversationRef;
      if (!currentConversationId) {
        conversationRef = await addDoc(
          collection(db, `churches/${id}/users/${user.uid}/conversations`),
          {
            tema: request.tema,
            createdAt: serverTimestamp(),
            lastMessage: request.input,
            lastUpdated: serverTimestamp(),
          }
        );
        setCurrentConversationId(conversationRef.id);
      }

      const conversationId = currentConversationId || conversationRef.id;

      await addDoc(
        collection(db, `churches/${id}/users/${user.uid}/conversations/${conversationId}/messages`),
        {
          role: 'user',
          content: request.input,
          createdAt: serverTimestamp(),
        }
      );

      const systemPromptCost = calculateTokenCost(prompts[request.tema]);
      const userMessageCost = calculateTokenCost(request.input);
      const totalInputCost = systemPromptCost + userMessageCost;

      if (
        request.tema === 'creativo' &&
        (request.input.toLowerCase().includes('diseñ') ||
          request.input.toLowerCase().includes('video') ||
          request.input.toLowerCase().includes('logo') ||
          request.input.toLowerCase().includes('brand'))
      ) {
        const customResponse = `# 🎨 Servicio de Diseño Profesional

> "La excelencia visual para la gloria de Dios"

## Solicitud de Diseño Recibida

¡Gracias por tu interés en crear contenido visual de calidad! Para asegurarnos de que recibas el mejor resultado posible, nuestro equipo de diseño profesional en Iglesia Tech puede ayudarte personalmente.

### 📞 Contacta a Nuestro Equipo:
* **WhatsApp/Teléfono:** 703-953-2729
* **Email:** annie@iglesiatech.com

### ✨ Beneficios:
* Diseño profesional personalizado
* Atención directa y personal
* Resultados de alta calidad
* Experiencia en diseño ministerial
* Entrega rápida y profesional

---

### 💡 Mientras tanto, puedo ayudarte con:
* Consejos de diseño
* Recomendaciones de estilo
* Mejores prácticas
* Referencias visuales

¿Te gustaría discutir algún aspecto específico del diseño mientras contactas a nuestro equipo?`;

        setMessages([
          ...request.messages,
          { role: 'user', content: request.input },
          { role: 'assistant', content: customResponse },
        ]);
        return;
      }

      let systemMessage = `Soy un Asistente Pastoral con experiencia en ministerio y administración de iglesias. Mi objetivo es ayudarte de manera práctica y espiritual.

Características de mi asistencia:
- Respondo desde una perspectiva pastoral
- Proporciono soluciones prácticas y aplicables
- Mantengo un enfoque ministerial
- Considero el contexto eclesiástico
- Ofrezco recursos relevantes

${prompts[request.tema]}\n\n

Responderé usando este formato:

# 💡 [Título Relevante]

## Respuesta Pastoral
[Respuesta directa a tu pregunta/necesidad]

### Plan de Acción Ministerial:
1. **Implementación Inmediata:**
   - [Acción práctica específica]
   - [Recurso ministerial relevante]

2. **Desarrollo a Corto Plazo:**
   - [Pasos ministeriales]
   - [Objetivos pastorales]

3. **Visión a Largo Plazo:**
   - [Estrategia ministerial]
   - [Metas de crecimiento]

## 🛠️ Recursos Ministeriales
* [Herramientas específicas]
* [Recursos pastorales]
* [Material de apoyo]

## ✅ Próximos Pasos
1. [Acción ministerial #1]
2. [Acción ministerial #2]
3. [Acción ministerial #3]

## 💡 Apoyo Pastoral Adicional
* ¿Necesitas profundizar en algún aspecto?
* ¿Requieres recursos específicos?
* ¿Te gustaría una consulta personalizada?

---
¿En qué otro aspecto pastoral puedo ayudarte?`;

      if (request.tema === 'devocional') {
        systemMessage = `Eres un Asistente Pastoral especializado en crear devocionales bíblicos completos y detallados. 
Cuando te pidan un devocional o serie de devocionales, SIEMPRE proporciona el contenido completo, no solo un resumen o estructura.

Para cada devocional, incluye:

# 📖 [Título del Devocional]

## 📅 Día [Número]: [Tema Específico]

### 📑 Pasaje Bíblico:
[Versículo completo con referencia]

### 🔍 Reflexión Principal:
[Mínimo 300 palabras de reflexión profunda]

### 🙏 Oración del Día:
[Oración específica relacionada con el tema]

### ✝️ Aplicación Práctica:
1. [Acción específica para hoy]
2. [Manera de aplicar la enseñanza]
3. [Paso práctico de fe]

### 📝 Espacio de Reflexión:
* Preguntas para meditar:
  1. [Pregunta personal]
  2. [Pregunta de aplicación]
  3. [Pregunta de crecimiento]

### 🎯 Desafío del Día:
[Reto específico relacionado con el tema]

### 📌 Versículo para Memorizar:
[Versículo clave del día]

---
Si te piden una serie de devocionales, proporciona el contenido completo de TODOS los días solicitados, no solo una estructura o resumen.`;
      } else if (request.tema === 'musica' || request.tema === 'creativo') {
        // ... existing music and creative formats
      } else {
        // ... existing default format
      }

      const response = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model: 'gpt-4',
          messages: [
            {
              role: 'system',
              content: systemMessage,
            },
            ...newMessages,
          ],
          temperature: 0.7,
        }),
      });

      if (!response.ok) {
        throw new Error(`API error: ${response.status}`);
      }

      const data = await response.json();

      if (!data?.choices?.[0]?.message?.content) {
        throw new Error('Invalid API response format');
      }

      const aiMessage = data.choices[0].message.content;
      setMessages([...newMessages, { role: 'assistant', content: aiMessage }]);

      const outputCost = calculateTokenCost(aiMessage, true);
      const totalCost = totalInputCost + outputCost;

      await updateDoc(
        doc(db, `churches/${id}/users/${user.uid}/conversations/${conversationId}`),
        {
          lastMessage: aiMessage,
          lastUpdated: serverTimestamp(),
          totalCost: increment(totalCost),
          inputTokens: increment(Math.ceil(request.input.length / 3.5)),
          outputTokens: increment(Math.ceil(aiMessage.length / 3.5)),
        }
      );

      console.log(`Conversation cost: $${totalCost.toFixed(4)}`);
      console.log(`Input tokens: ~${Math.ceil((prompts[request.tema].length + request.input.length) / 3.5)}`);
      console.log(`Output tokens: ~${Math.ceil(aiMessage.length / 3.5)}`);

      clearInterval(progressInterval);
      setProgress(100);

      setTimeout(() => {
        setProgress(0);
        setLoading(false);
      }, 500);

      await addDoc(
        collection(db, `churches/${id}/users/${user.uid}/conversations/${conversationId}/messages`),
        {
          role: 'assistant',
          content: aiMessage,
          createdAt: serverTimestamp(),
        }
      );

      await updateDoc(
        doc(db, `churches/${id}/users/${user.uid}/conversations/${conversationId}`),
        {
          lastMessage: aiMessage,
          lastUpdated: serverTimestamp(),
        }
      );

      fetchConversations();
    } catch (error) {
      setProgress(0);
      setLoading(false);
      console.error('Error:', error);
      setMessages([
        ...request.messages,
        { role: 'user', content: request.input },
        {
          role: 'assistant',
          content: 'Lo siento, hubo un error al procesar tu solicitud. Por favor intenta nuevamente.',
        },
      ]);
    }
  };

  const enviarAChatGPT = async () => {
    if (!userInput || !tema || !user) return;

    const request = {
      input: userInput,
      tema,
      messages: [...messages],
    };

    if (loading) {
      setRequestQueue(prev => [...prev, request]);
      setUserInput('');

      setMessages(prev => [
        ...prev,
        { role: 'user', content: userInput },
        { role: 'assistant', content: '⌛ Tu pregunta ha sido añadida a la cola y será procesada pronto.' },
      ]);
    } else {
      await processRequest(request);
    }
  };

  const terminarConversacion = () => {
    const getTopicRecommendations = (tema) => {
      const recommendations = {
        sermon: {
          next: "• Revisa nuestros recursos de predicación\n• Agenda una mentoría homilética\n• Explora nuestra biblioteca de sermones",
          tools: "• Software de preparación de sermones\n• Recursos de ilustraciones\n• Biblioteca de comentarios"
        },
        admin: {
          next: "• Implementa un sistema de gestión financiera\n• Agenda una consultoría administrativa\n• Desarrolla un plan financiero",
          tools: "• Software de contabilidad para iglesias\n• Plantillas de presupuesto\n• Herramientas de gestión"
        },
        musica: {
          next: "• Coordina un entrenamiento para tu equipo\n• Actualiza tu equipamiento técnico\n• Mejora la producción musical",
          tools: "• Software de producción musical\n• Recursos de adoración\n• Equipamiento técnico"
        },
        // ...add other topics as needed
      };

      return recommendations[tema] || {
        next: "• Agenda una consulta personalizada\n• Explora más recursos\n• Únete a nuestra comunidad",
        tools: "• Recursos ministeriales\n• Herramientas pastorales\n• Material de capacitación"
      };
    };

    const recommendations = getTopicRecommendations(tema);
    const farewellMessage = `# 🙏 ¡Gracias por usar nuestro Asistente Pastoral!

## 📋 Resumen y Próximos Pasos

### ✨ Recomendaciones Personalizadas:
${recommendations.next}

### 🛠️ Herramientas Sugeridas:
${recommendations.tools}

## 📞 ¿Necesitas más ayuda?
Nuestro equipo está listo para apoyarte:
* 📱 WhatsApp: 703-953-2729
* 📧 Email: info@iglesiatech.com
* 🌐 www.iglesiatech.com

### 💡 Servicios Disponibles:
* Consultoría personalizada
* Visitas a tu iglesia
* Capacitación de equipos
* Implementación de soluciones

---
*¿Te gustaría agendar una consulta personalizada para profundizar en este tema?*`;

    setMessages([...messages, { role: 'assistant', content: farewellMessage }]);

    const lastUserMessage = messages.find(m => m.role === 'user')?.content?.toLowerCase() || '';
    if (
      lastUserMessage.includes('si') ||
      lastUserMessage.includes('sí') ||
      lastUserMessage.includes('visita') ||
      lastUserMessage.includes('interesa')
    ) {
      updateDoc(
        doc(db, `churches/${id}/users/${user.uid}/conversations/${currentConversationId}`),
        {
          isPriority: true,
          interestedInVisit: true,
          lastResponse: lastUserMessage,
        }
      );
    }

    setTema('');
  };

  const loadConversation = async (conversationId) => {
    try {
      setCurrentConversationId(conversationId);
      const q = query(
        collection(db, `churches/${id}/users/${user.uid}/conversations/${conversationId}/messages`),
        orderBy('createdAt', 'asc')
      );
      const snapshot = await getDocs(q);
      const messages = snapshot.docs.map(doc => doc.data());
      setMessages(messages);

      const convoDoc = await getDoc(doc(db, `churches/${id}/users/${user.uid}/conversations/${conversationId}`));
      const convoData = convoDoc.data();
      setTema(convoData.tema);
    } catch (error) {
      console.error('Error loading conversation:', error);
    }
  };

  const deleteConversation = async (conversationId, e) => {
    e.stopPropagation();
    try {
      await deleteDoc(doc(db, `churches/${id}/users/${user.uid}/conversations/${conversationId}`));
      if (currentConversationId === conversationId) {
        setCurrentConversationId(null);
        setMessages([]);
        setTema('');
      }
      fetchConversations();
    } catch (error) {
      console.error('Error deleting conversation:', error);
    }
  };

  const renameConversation = async (conversationId, e) => {
    e.stopPropagation();
    const newTitle = prompt('Ingrese el nuevo título:');
    if (newTitle?.trim()) {
      try {
        await updateDoc(
          doc(db, `churches/${id}/users/${user.uid}/conversations/${conversationId}`),
          { tema: newTitle }
        );
        fetchConversations();
      } catch (error) {
        console.error('Error renaming conversation:', error);
      }
    }
  };

  const fetchTotalMonthlyCosts = async () => {
    try {
      const startOfMonth = new Date();
      startOfMonth.setDate(1);
      startOfMonth.setHours(0, 0, 0, 0);

      const q = query(
        collection(db, `churches/${id}/users/${user.uid}/conversations`),
        where('createdAt', '>=', startOfMonth)
      );

      const snapshot = await getDocs(q);
      const totalCost = snapshot.docs.reduce((acc, doc) => acc + (doc.data().totalCost || 0), 0);

      console.log(`Total cost this month: $${totalCost.toFixed(2)} USD`);
      return totalCost;
    } catch (error) {
      console.error('Error calculating monthly costs:', error);
      return 0;
    }
  };

  const QueueIndicator = () => (
    <div className="fixed bottom-4 right-4 bg-indigo-600 text-white px-4 py-2 rounded-lg shadow-lg">
      <div className="flex items-center gap-2">
        <span className="animate-pulse">⌛</span>
        <span>{requestQueue.length} {requestQueue.length === 1 ? 'pregunta' : 'preguntas'} en cola</span>
      </div>
    </div>
  );

  return (
    <div style={commonStyles.container}>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '20px' }}>
        <button
          onClick={() => navigate(`/church/${id}/mi-perfil`)}
          style={commonStyles.backButton}
        >
          ← Volver
        </button>
        <button
          onClick={() => navigate(`/church/${id}/cost-analytics`)}
          style={{ ...commonStyles.indigoButton }}
        >
          📊 Ver Análisis de Costos
        </button>
      </div>

      <ChurchHeader id={id} applyShadow={false} />

      <div style={{ ...commonStyles.topBorder, marginTop: "-30px" }}>
        <h2 style={{...commonStyles.title, marginBottom:"30px"}}>Asistente Pastoral con IA</h2>

        {!tema ? (
          <div>
            {Object.entries(prompts).map(([key, _]) => (
              <button
                key={key}
                onClick={() => handleBoton(key)}
                style={{
                  ...commonStyles.indigoButton,
                  width: '100%',
                  textAlign: "left"
                }}
              >
                <div className="flex flex-col">
                  <span className="text-xl font-medium mb-1">
                    {getButtonLabel(key)}
                  </span>
                  <span className="text-sm opacity-90">
                    {key === 'sermon' && 'Preparación de sermones y mensajes'}
                    {key === 'estudio' && 'Estudios bíblicos profundos'}
                    {key === 'oracion' && 'Guías de oración y devocionales'}
                    {key === 'eventos' && 'Planificación de eventos'}
                    {key === 'mensaje' && 'Mensajes para redes sociales'}
                    {key === 'seguimiento' && 'Seguimiento pastoral'}
                    {key === '501c3' && 'Documentación legal'}
                    {key === 'devocional' && 'Devocionales diarios'}
                    {key === 'estructura' && 'Estructura ministerial'}
                    {key === 'admin' && 'Administración y finanzas'}
                    {key === 'liderazgo' && 'Desarrollo de líderes'}
                    {key === 'creativo' && 'Recursos creativos'}
                    {key === 'tecnologia' && 'Soluciones tecnológicas'}
                    {key === 'musica' && 'Música y adoración'}
                  </span>
                </div>
              </button>
            ))}
          </div>
        ) : (
          <div>
            <div className="flex">
              <Sidebar
                conversations={conversations}
                startNewConversation={startNewConversation}
                loadConversation={loadConversation}
                currentConversationId={currentConversationId}
                showHistory={showHistory}
                setShowHistory={setShowHistory}
                tema={tema}  // Pass tema as prop
                renameConversation={renameConversation}  // Pass the functions
                deleteConversation={deleteConversation}   // Pass the functions
              />
              <div className="flex-1">
                <div style={{ backgroundColor: "#f7f7f7", padding: "20px", marginBottom: "20px", borderRadius: "10px" }}>
                  {messages.map((msg, index) => (
                    <div
                      key={index}
                      style={{ ...messageStyles[msg.role], marginBottom: index === messages.length - 1 ? '0' : '20px' }}
                    >
                      <div
                        style={
                          msg.role === 'user'
                            ? messageStyles.header.userHeader
                            : messageStyles.header.assistantHeader
                        }
                        className="relative"  // Add relative positioning to header
                      >
                        {msg.role === 'user' ? '💭 Tu pregunta:' : '🤖 Respuesta del Asistente:'}
                        {msg.role === 'assistant' && <CopyButton text={msg.content || ''} />}
                      </div>
                      <div className="relative mt-2">  {/* Add margin-top for spacing */}
                        {index === messages.length - 1 && msg.role === 'assistant' ? (
                          loading ? (
                            <ThinkingAnimation />
                          ) : (
                            <TypingAnimation
                              text={msg.content || ''}
                              isTyping={setIsTypingResponse}
                            />
                          )
                        ) : (
                          <div style={msg.role === 'user' ? markdownStyles.user : markdownStyles.assistant}>
                            <ReactMarkdown
                              components={{
                                // Add custom styling to markdown elements
                                h1: ({ node, ...props }) => <h1 style={{ fontSize: '1rem', fontWeight: 'bold', marginBottom: '1rem' }} {...props} />,
                                h2: ({ node, ...props }) => <h2 style={{ fontSize: '0.75rem', fontWeight: 'bold', marginBottom: '0.75rem' }} {...props} />,
                                h3: ({ node, ...props }) => <h3 style={{ fontSize: '0.5rem', fontWeight: 'bold', marginBottom: '0.5rem' }} {...props} />,
                                p: ({ node, ...props }) => <p style={{ marginBottom: '0.75rem' }} {...props} />,
                                ul: ({ node, ...props }) => <ul style={{ marginLeft: '1.5rem', marginBottom: '0.75rem', listStyle: 'disc' }} {...props} />,
                                ol: ({ node, ...props }) => <ol style={{ marginLeft: '1.5rem', marginBottom: '0.75rem', listStyle: 'decimal' }} {...props} />,
                                li: ({ node, ...props }) => <li style={{ marginBottom: '0.25rem' }} {...props} />,
                                blockquote: ({ node, ...props }) => <blockquote style={{ borderLeft: '4px solid #E5E7EB', paddingLeft: '1rem', marginBottom: '1rem' }} {...props} />
                              }}
                            >
                              {msg.content || ''}
                            </ReactMarkdown>
                          </div>
                        )}
                      </div>
                    </div>
                  ))}
                  <div ref={chatEndRef} />
                </div>

                <div style={additionalStyles.disabledOverlay}>
                  {loading && (
                    <div style={additionalStyles.progressOverlay}>
                      <div style={additionalStyles.progressText}>
                        {progress < 90 ? `${progress}% completado` : 'Finalizando respuesta...'}
                      </div>
                      <div style={additionalStyles.progressContainer}>
                        <div
                          style={{
                            ...additionalStyles.progressBar,
                            width: `${progress}%`
                          }}
                        />
                      </div>
                    </div>
                  )}
                  <textarea
                    style={{
                      width: '100%',
                      padding: '12px',
                      border: '1px solid #E5E7EB',
                      borderRadius: '6px',
                      fontSize: '16px',
                      resize: 'vertical',
                      opacity: loading ? 0.5 : 1,
                      pointerEvents: loading ? 'none' : 'auto',
                    }}
                    rows="3"
                    value={userInput}
                    onChange={(e) => setUserInput(e.target.value)}
                    placeholder={
                      loading ? 'Espera mientras se procesa la respuesta anterior...' :
                        isTypingResponse ? 'Espera mientras se completa la respuesta...' :
                          'Escribe tu respuesta...'
                    }
                    disabled={loading || isTypingResponse}
                  />
                </div>
                <button
                  onClick={enviarAChatGPT}
                  style={{
                    ...commonStyles.greenButton,
                    width: "100%"
                  }}
                  disabled={loading || isTypingResponse}
                >
                  {loading ? 'Procesando...' :
                    isTypingResponse ? 'Completando respuesta...' :
                      'Enviar'}
                </button>
                <button
                  onClick={terminarConversacion}
                  style={{ ...commonStyles.redButton, width: "100%" }}
                >
                  Terminar Conversación
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
      {requestQueue.length > 0 && <QueueIndicator />}
    </div>
  );
};

const CostSummary = ({ conversation }) => {
  if (!conversation?.totalCost) return null;

  return (
    <div className="text-xs text-gray-500 mt-1">
      Costo: ${conversation.totalCost.toFixed(4)} USD
    </div>
  );
};

const ButtonStyle = {
  base: {
    // ...commonStyles.mainButtonStyle,
    width: '100%',
    transition: 'all 0.2s ease',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: '0.5rem',
  },
  red: {
    backgroundColor: '#EF4444',
    color: 'white',
  },
  gray: {
    backgroundColor: '#6B7280',
    color: 'white',
  }
};

const markdownStyles = {
  user: {
    color: '#1F2937', // text-gray-800
  },
  assistant: {
    color: '#312E81', // text-indigo-900
  }
};

const Sidebar = ({ conversations, startNewConversation, loadConversation, currentConversationId, showHistory, setShowHistory, tema, renameConversation, deleteConversation }) => {
  return (
    <div>
      <div>
        <div className="flex flex-col gap-2">
          <button
            onClick={startNewConversation}
            style={{ ...commonStyles.greenButton, width: "100%" }}
          >
            <span>+ Nueva Conversación</span>
          </button>

          <button
            onClick={() => setShowHistory(prev => !prev)}
            style={{ ...commonStyles.indigoButton, width: "100%" }}
          >
            <span>{showHistory ? '← Ocultar Historial' : '📚 Ver Historial'}</span>
          </button>
        </div>

        {showHistory && (
          <div style={{ marginBottom: "20px" }}>
            {conversations
              .filter(convo => convo.tema === tema || !tema)
              .map((convo) => (
                <div key={convo.id}>
                  <div className="p-3 border border-gray-200" style={{ borderRadius: "10px" }}>
                    <div
                      onClick={() => loadConversation(convo.id)}
                    >
                      <div className="flex flex-col">
                        <span className="font-medium text-gray-900">
                          {convo.title || `Conversación del ${new Date(convo.createdAt?.seconds * 1000).toLocaleDateString()}`}
                        </span>
                        <span className="text-sm text-gray-500 truncate">
                          {convo.lastMessage?.slice(0, 50) || 'Nueva conversación'}...
                        </span>
                      </div>
                    </div>

                    <div style={{ marginTop: "10px", display: "flex", alignItems: "center", gap: "10px", justifyContent: "center" }}>
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          e.preventDefault();
                          renameConversation(convo.id, e);
                        }}
                        style={{ ...commonStyles.indigoButton, margin: "0", padding: "10px" }}
                        title="Renombrar"
                      >
                        ✏️
                      </button>
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          e.preventDefault();
                          deleteConversation(convo.id, e);
                        }}
                        style={{ ...commonStyles.redButton, margin: "0", padding: "10px" }}
                        title="Eliminar"
                      >
                        🗑️
                      </button>
                    </div>
                  </div>
                </div>
              ))}
          </div>
        )}
      </div>
    </div>
  );
};

export default AsistentePastoral;