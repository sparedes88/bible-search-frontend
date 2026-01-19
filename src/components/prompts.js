export const prompts = {
  sermon: `¡Hola! Soy tu Asistente Pastoral para consultas sobre predicación y sermones. Puedo ayudarte con:
- 📖 Interpretación de textos bíblicos
- 🎯 Desarrollo de temas específicos
- 💡 Ideas para ilustraciones
- 📝 Estructura de mensajes
- 🔍 Investigación teológica
- 📚 Recursos homiléticos
- ❓ Dudas sobre pasajes`,
  
  estudio: `¡Hola! Soy tu Asistente Pastoral para estudios bíblicos. Puedo ayudarte con:
- 📚 Interpretación de pasajes
- 🔍 Análisis del contexto histórico
- 💭 Significado de palabras originales
- 📖 Conexiones teológicas
- 🎯 Aplicaciones prácticas
- ❓ Preguntas difíciles
- 📋 Material de estudio`,

  oracion: `¡Hola! Soy tu Asistente Pastoral para temas de oración. Puedo ayudarte con:
- 🙏 Necesidades específicas de oración
- 📖 Base bíblica para la oración
- 💡 Estrategias de oración
- 👥 Ministerio de intercesión
- ❓ Preguntas sobre oración
- 📝 Guías de oración
- 🎯 Oración específica`,

  eventos: `¡Hola! Yo soy tu Asistente Pastoral, puedo ayudarte a planificar eventos de la iglesia.`,
  
  mensaje: `¡Hola! Yo soy tu Asistente Pastoral, puedo ayudarte a preparar mensajes y devocionales.`,
  
  seguimiento: `¡Hola! Yo soy tu Asistente Pastoral, puedo ayudarte con el seguimiento pastoral.`,
  
  '501c3': `¡Hola! Yo soy tu Asistente Pastoral, puedo ayudarte con documentación legal.`,
  
  devocional: `¡Hola! Yo soy tu Asistente Pastoral, puedo ayudarte a crear devocionales.`,
  
  estructura: `¡Hola! Yo soy tu Asistente Pastoral, tengo el conocimiento de un consultor experto en desarrollo y estructuración de iglesias.`,
  
  admin: `¡Hola! Soy tu Asistente Pastoral especializado en administración y finanzas de iglesias. Puedo ayudarte con:

- 💰 Gestión financiera y presupuestos
- 📊 Análisis de ingresos y gastos
- 📈 Planificación financiera
- 📑 Cumplimiento fiscal
- 💼 Procedimientos administrativos
- 🏦 Manejo de donaciones
- 📝 Reportes financieros
- 🔄 Flujo de caja
- 📋 Control de gastos
- ⚖️ Contabilidad básica
- 🎯 Metas financieras
- 💡 Software financiero

Para preguntas específicas sobre:
* Presupuestos ministeriales
* Inversiones de la iglesia
* Gestión de nómina
* Auditorías internas
* Planificación de proyectos
* Control de recursos

También puedo proporcionar:
* Plantillas financieras
* Herramientas de gestión
* Recursos administrativos
* Mejores prácticas

¿En qué área específica de las finanzas o administración de tu iglesia puedo ayudarte hoy?`,

  liderazgo: `¡Hola! Soy tu Asistente Pastoral para desarrollo de liderazgo. Puedo ayudarte con:
- 👥 Desafíos de equipo
- 💡 Desarrollo de líderes
- 🎯 Resolución de conflictos
- 📊 Evaluación de ministerios
- ❓ Consultas sobre liderazgo
- 📚 Recursos de mentoría
- 🤝 Trabajo en equipo`,

  creativo: `¡Hola! Yo soy tu Asistente Pastoral especializado en dirección creativa y diseño para iglesias.

Para solicitudes de diseño, videos o recursos visuales personalizados, nuestro equipo de Iglesia Tech está listo para ayudarte.

Contacta a nuestro equipo de diseño:
📱 WhatsApp/Teléfono: 703-953-2729
📧 Email: info@iglesiatech.com`,
  
  tecnologia: `¡Hola! Yo soy tu Asistente Pastoral, tengo el conocimiento de un especialista en tecnología para iglesias.`,
  
  musica: `¡Hola! Soy tu Asistente Pastoral especializado en música y adoración. Puedo ayudarte con:

- 🎵 Secuencias musicales y arreglos
- 🎹 Progresiones de acordes y tonalidades
- 👥 Dirección del equipo de alabanza
- 📚 Recursos de adoración y música
- 🎼 Planificación musical para servicios
- 🎸 Recomendaciones de instrumentación
- 🎤 Técnicas vocales y ensayos
- 📱 Software y herramientas musicales
- 🙏 Aspectos espirituales de la adoración
- 📖 Teología de la adoración

Para secuencias musicales, por favor incluye:
- Nombre de la canción
- Tonalidad deseada
- Estilo/género
- Tempo aproximado (BPM)
- Instrumentos requeridos

También puedo recomendar recursos y contactos para:
- Producción musical profesional
- Equipamiento de audio
- Capacitación del equipo
- Consultoría técnica personalizada`,
};

export const getButtonLabel = (key) => {
  const labels = {
    sermon: '📝 Sermón',
    estudio: '📚 Estudio Bíblico',
    oracion: '🙏 Oración',
    eventos: '📅 Eventos',
    mensaje: '📱 Mensaje',
    seguimiento: '❤️ Seguimiento',
    '501c3': '📋 501c3',
    devocional: '📖 Devocional',
    estructura: '🏛️ Estructura Ministerial',
    admin: '💰 Admin y Finanzas',
    liderazgo: '👥 Desarrollo de Líderes',
    creativo: '🎨 Director Creativo',
    tecnologia: '💻 Tecnología',
    musica: '🎵 Música y Recursos de Adoración'
  };
  return labels[key] || key;
};