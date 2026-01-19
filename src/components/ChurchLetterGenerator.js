import React, { useState, useRef, useEffect } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { jsPDF } from "jspdf";
import SignatureCanvas from "react-signature-canvas";
import OpenAI from "openai";
import axios from "axios";
import {
  Button,
  TextField,
  Select,
  MenuItem,
  Typography,
  Container,
  Box,
  Paper,
  CircularProgress,
  FormControl,
  InputLabel,
} from "@mui/material";
import Skeleton from "react-loading-skeleton";
import "react-loading-skeleton/dist/skeleton.css";
import commonStyles from "../pages/commonStyles";

// Load OpenAI API Key from .env
const OPENAI_API_KEY = process.env.REACT_APP_OPENAI_API_KEY;
const openai = new OpenAI({
  apiKey: OPENAI_API_KEY,
  dangerouslyAllowBrowser: true,
});

const API_BASE_URL = "https://iglesia-tech-api.e2api.com";

const ChurchLetterGenerator = () => {
  const { id } = useParams();
  const navigate = useNavigate();
  const [church, setChurch] = useState(null);
  const [messages, setMessages] = useState([
    { role: "system", content: "¿Qué tipo de carta necesitas?" },
  ]);
  const [userInput, setUserInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [letter, setLetter] = useState("");
  const [customLetter, setCustomLetter] = useState("");
  const [exportLanguage, setExportLanguage] = useState("");
  const sigCanvas = useRef(null);
  const [signature, setSignature] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    const fetchChurchInfo = async () => {
      try {
        const response = await axios.get(`${API_BASE_URL}/api/iglesiaTechApp/iglesias/getIglesiaProfileDetail?idIglesia=${id}`);
        setChurch(response.data.iglesia);
      } catch (error) {
        console.error("Error fetching church info:", error);
      }
    };
    fetchChurchInfo();
  }, [id]);

  // Handle sending a message
  const handleSendMessage = async () => {
    if (!userInput.trim()) return;

    const newMessages = [...messages, { role: "user", content: userInput }];
    setMessages(newMessages);
    setUserInput("");
    setLoading(true);
    setError("");

    if (!OPENAI_API_KEY) {
      setError("⚠ Error: La clave de OpenAI no está configurada en el archivo .env.");
      setLoading(false);
      return;
    }

    try {
      const response = await openai.chat.completions.create({
        model: "gpt-4",
        messages: newMessages,
      });

      if (response.choices && response.choices[0]?.message?.content) {
        const botResponse = response.choices[0].message.content;
        setMessages([...newMessages, { role: "assistant", content: botResponse }]);

        // If ChatGPT generates a letter, show preview options
        if (botResponse.includes("Estimado") || botResponse.includes("Dear")) {
          setLetter(botResponse);
          setCustomLetter(botResponse);
        }
      }
    } catch (err) {
      console.error("❌ ChatGPT Error:", err);
      setError("⚠ Error al conectar con ChatGPT. Verifique su API Key.");
    } finally {
      setLoading(false);
    }
  };

  // Save Signature
  const saveSignature = () => setSignature(sigCanvas.current.toDataURL());
  const clearSignature = () => {
    sigCanvas.current.clear();
    setSignature("");
  };

  // Export PDF
  const downloadPDF = () => {
    if (!exportLanguage) {
      alert("⚠ Por favor, selecciona un idioma para exportar.");
      return;
    }

    const doc = new jsPDF("p", "mm", "a4");
    doc.setFontSize(12);
    doc.text(customLetter, 10, 50, { maxWidth: 190 });

    if (signature) {
      doc.addImage(signature, "PNG", 75, 220, 60, 20);
    }

    doc.text("501(c)(3) - Organización sin fines de lucro", 10, 280);
    doc.save(`Carta_${exportLanguage}.pdf`);
  };

  return (
    <Container maxWidth="md">
      <Box textAlign="center" mt={4}>
        {/* Banner */}
        <div style={commonStyles.banner}>
          {loading ? <Skeleton height={300} /> : church?.portadaArticulos ? (
            <img src={`https://iglesia-tech-api.e2api.com${church.portadaArticulos}`} alt="Church Banner" style={commonStyles.bannerImage} />
          ) : <Skeleton height={300} />}
        </div>

        {/* Logo */}
        <div style={commonStyles.logoContainer}>
          {loading ? <Skeleton circle height={90} width={90} /> : church?.Logo ? (
            <img src={`https://iglesia-tech-api.e2api.com${church.Logo}`} alt="Church Logo" style={commonStyles.logo} />
          ) : <Skeleton circle height={90} width={90} />}
        </div>

        {/* Back Button */}
        <button onClick={() => navigate(-1)} style={commonStyles.backButton}>⬅ Volver</button>

        <Typography variant="h4">Generador de Cartas con ChatGPT</Typography>

        {/* Show API Error */}
        {error && (
          <Paper elevation={3} style={{ padding: "10px", marginTop: "10px", backgroundColor: "#ffcccc" }}>
            <Typography variant="h6" color="error">{error}</Typography>
          </Paper>
        )}

        {/* Chat Window */}
        <Paper elevation={3} style={{ padding: "15px", marginTop: "20px", maxHeight: "300px", overflowY: "auto" }}>
          {messages.map((msg, index) => (
            <Box key={index} style={{ textAlign: msg.role === "user" ? "right" : "left" }}>
              <Typography variant="body1">
                <strong>{msg.role === "user" ? "Tú" : "ChatGPT"}:</strong> {msg.content}
              </Typography>
            </Box>
          ))}
          {loading && <CircularProgress size={20} />}
        </Paper>

        {/* Chat Input */}
        <TextField
          fullWidth
          label="Escribe un mensaje..."
          value={userInput}
          onChange={(e) => setUserInput(e.target.value)}
          onKeyPress={(e) => e.key === "Enter" && handleSendMessage()}
          style={{ marginTop: "10px" }}
        />
        <Button variant="contained" color="primary" onClick={handleSendMessage} style={{ marginTop: "10px" }}>
          Enviar
        </Button>

        {/* Letter Preview */}
        {letter && (
          <Paper elevation={3} style={{ padding: "20px", marginTop: "20px" }}>
            <Typography variant="h6">Vista Previa de la Carta</Typography>
            <TextField
              value={customLetter}
              onChange={(e) => setCustomLetter(e.target.value)}
              multiline
              rows={10}
              fullWidth
              variant="outlined"
            />
            <FormControl fullWidth style={{ marginTop: "10px" }}>
              <InputLabel>🌍 Selecciona Idioma de Exportación</InputLabel>
              <Select value={exportLanguage} onChange={(e) => setExportLanguage(e.target.value)}>
                <MenuItem value="es">Español</MenuItem>
                <MenuItem value="en">Inglés</MenuItem>
                <MenuItem value="pt">Portugués</MenuItem>
                <MenuItem value="all">Todos</MenuItem>
              </Select>
            </FormControl>
            <Button variant="contained" color="primary" onClick={downloadPDF} style={{ marginTop: "15px" }}>
              📄 Descargar PDF
            </Button>
          </Paper>
        )}

        {/* Signature Input */}
        {letter && (
          <>
            <Typography variant="h6" gutterBottom mt={3}>✒ Firma del Pastor</Typography>
            <SignatureCanvas ref={sigCanvas} penColor="black" canvasProps={{ width: 400, height: 100, className: "sigCanvas" }} />
            <Button onClick={saveSignature} style={{ marginRight: "10px", marginTop: "10px" }}>Guardar Firma</Button>
            <Button onClick={clearSignature} style={{ marginTop: "10px" }}>Borrar Firma</Button>
          </>
        )}
      </Box>
    </Container>
  );
};

export default ChurchLetterGenerator;
