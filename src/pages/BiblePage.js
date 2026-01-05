import React, { useState, useEffect } from "react";
import { useParams, useNavigate } from "react-router-dom";
import Skeleton from "react-loading-skeleton";
import "react-loading-skeleton/dist/skeleton.css";
import { searchChurchById } from "../api";
import commonStyles from "./commonStyles";
import "./pages.responsive.css";

const OPENAI_API_KEY = process.env.REACT_APP_OPENAI_API_KEY;

const BiblePage = () => {
  const { id } = useParams();
  const navigate = useNavigate();
  const [church, setChurch] = useState(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState(null);
  const [history, setHistory] = useState([]);
  const [loading, setLoading] = useState(true);
  const [backLoading, setBackLoading] = useState(false);
  const [tapCount, setTapCount] = useState(0);

  useEffect(() => {
    const fetchData = async () => {
      setLoading(true);
      const churchData = await searchChurchById(id);
      setChurch(churchData);
      setTimeout(() => setLoading(false), 1000);
    };
    fetchData();
  }, [id]);

  const handleSearch = async () => {
    if (!searchQuery.trim()) return;
    setLoading(true);

    try {
      const response = await fetch("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${OPENAI_API_KEY}`,
        },
        body: JSON.stringify({
          model: "gpt-4",
          messages: [
            {
              role: "system",
              content: "Responde solo con versículos de la Biblia en la versión Reina Valera 1960, en español. Asegúrate de incluir la referencia completa (libro, capítulo y versículo) al final en una línea separada.",
            },
            {
              role: "user",
              content: `Busca los siguientes versículos en la Biblia (Reina Valera 1960): ${searchQuery}`,
            },
          ],
          temperature: 0.7,
        }),
      });

      if (!response.ok) {
        throw new Error("Error al buscar los versículos. Verifica tu API Key.");
      }

      const data = await response.json();
      const bibleText = data.choices?.[0]?.message?.content || "No se encontraron resultados.";

      setSearchResults(bibleText);
      setHistory(prev => [...prev, { query: searchQuery, result: bibleText }]);
    } catch (error) {
      console.error("❌ Error fetching Bible verses:", error);
      setSearchResults("Hubo un error en la búsqueda.");
    }

    setLoading(false);
  };

  const handleBackClick = () => {
    setBackLoading(true);
    setTimeout(() => {
      navigate(-1);
      setBackLoading(false);
    }, 800);
  };

  const handleLogoTap = () => {
    setTapCount(prev => prev + 1);
    if (tapCount + 1 === 4) {
      navigate("/");
      setTapCount(0);
    }
  };

  return (
    <div style={commonStyles.container}>
      {backLoading ? (
        <div style={commonStyles.fullPageLoader}>
          <Skeleton height={300} width="100%" />
          <Skeleton circle height={90} width={90} style={{ margin: "20px auto" }} />
          <Skeleton height={30} width="60%" />
          <Skeleton count={4} />
        </div>
      ) : (
        <>
          {/* Banner (Main Slider) */}
          <div style={commonStyles.banner}>
            {loading ? <Skeleton height={300} /> : (
              church && church.portadaArticulos ? (
                <img src={`https://iglesia-tech-api.e2api.com${church.portadaArticulos}`} alt="Church Banner" style={commonStyles.bannerImage} />
              ) : <Skeleton height={300} />
            )}
          </div>

          {/* Logo */}
          <div style={commonStyles.logoContainer} onClick={handleLogoTap}>
            {loading ? <Skeleton circle height={90} width={90} /> : (
              church && church.Logo ? (
                <img src={`https://iglesia-tech-api.e2api.com${church.Logo}`} alt="Church Logo" style={commonStyles.logo} />
              ) : <Skeleton circle height={90} width={90} />
            )}
          </div>

          {/* Back Button */}
          <button onClick={handleBackClick} style={commonStyles.backButton}>⬅ Volver</button>

          <h2 style={commonStyles.title}>📖 Biblia - Reina Valera 1960</h2>

          {/* Search Bar */}
          <div style={styles.searchContainer}>
            <input
              type="text"
              placeholder="Escribe versículos para buscar..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              style={styles.searchInput}
            />
            <button onClick={handleSearch} style={styles.searchButton}>Buscar</button>
          </div>

          {/* Search Results */}
          <div style={commonStyles.sectionContainer}>
            {loading ? <Skeleton count={4} /> : searchResults ? (
              <p style={styles.resultText}>{searchResults}</p>
            ) : (
              <p>Realiza una búsqueda para encontrar versículos.</p>
            )}
          </div>

          {/* Search History */}
          <div style={commonStyles.sectionContainer}>
            <h3>📜 Historial de Búsquedas</h3>
            {history.length === 0 ? (
              <p>No hay búsquedas recientes.</p>
            ) : (
              <ul style={styles.historyList}>
                {history.map((item, index) => (
                  <li key={index}>
                    <strong>{item.query}</strong>: {item.result}
                  </li>
                ))}
              </ul>
            )}
          </div>
        </>
      )}
    </div>
  );
};

// ✅ Ensuring `styles` object exists
const styles = {
  searchContainer: {
    display: "flex",
    justifyContent: "center",
    gap: "10px",
    marginBottom: "20px",
  },
  searchInput: {
    padding: "10px",
    fontSize: "16px",
    width: "70%",
    borderRadius: "5px",
    border: "1px solid #ccc",
    outline: "none",
  },
  searchButton: {
    padding: "10px 15px",
    fontSize: "16px",
    cursor: "pointer",
    backgroundColor: "#007bff",
    color: "white",
    border: "none",
    borderRadius: "5px",
  },
  resultText: {
    fontSize: "16px",
    fontWeight: "600",
    color: "#333",
    textAlign: "left",
    whiteSpace: "pre-line",
  },
  historyList: {
    textAlign: "left",
    paddingLeft: "10px",
    fontSize: "14px",
  },
};

export default BiblePage;
