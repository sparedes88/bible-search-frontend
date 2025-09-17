import React, { useEffect, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import Skeleton from "react-loading-skeleton";
import "react-loading-skeleton/dist/skeleton.css";
import Select from "react-select";
import { searchChurchById } from "../api";
import commonStyles from "./commonStyles";

const styles = {
  grid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fill, minmax(250px, 1fr))",
    gap: "15px",
    marginTop: "10px",
  },
  articleCard: {
    padding: "15px",
    borderRadius: "8px",
    backgroundColor: "#fff",
    textAlign: "center",
    boxShadow: "0px 4px 6px rgba(0,0,0,0.1)",
    cursor: "pointer", // Add cursor pointer to indicate clickable
  },
  articleImage: {
    width: "100%",
    height: "150px",
    objectFit: "cover",
    borderRadius: "8px",
  },
  searchBar: {
    padding: "10px",
    borderRadius: "8px",
    border: "1px solid #ccc",
    boxShadow: "0px 2px 4px rgba(0,0,0,0.1)",
    fontSize: "16px",
    width: "100%",
    maxWidth: "400px",
    marginBottom: "20px",
    margin: "0 auto",
  },
  selectDropdown: {
    padding: "10px",
    borderRadius: "8px",
    border: "1px solid #ccc",
    boxShadow: "0px 2px 4px rgba(0,0,0,0.1)",
    fontSize: "16px",
    width: "100%",
    maxWidth: "400px",
    marginBottom: "20px",
    margin: "0 auto",
    height: "48px", // Ensure the height matches the search bar
  },
  selectContainer: {
    width: "100%",
    maxWidth: "400px",
    margin: "0 auto",
    marginBottom: "20px", // Add space between search bar and dropdown
    marginTop: "20px", // Add space between search bar and dropdown
  },
  loadMoreButton: {
    padding: "10px 20px",
    borderRadius: "8px",
    border: "none",
    backgroundColor: "#007bff",
    color: "#fff",
    fontSize: "16px",
    cursor: "pointer",
    marginTop: "20px",
  },
};

const ArticlesPage = () => {
  const { id } = useParams();
  const navigate = useNavigate();
  const [church, setChurch] = useState(null);
  const [articles, setArticles] = useState([]);
  const [filteredArticles, setFilteredArticles] = useState([]);
  const [loading, setLoading] = useState(true);
  const [tapCount, setTapCount] = useState(0);
  const [searchTerm, setSearchTerm] = useState("");
  const [visibleCount, setVisibleCount] = useState(7);
  const [categories, setCategories] = useState([]);
  const [selectedCategories, setSelectedCategories] = useState([]);
  const [loadingMore, setLoadingMore] = useState(false);

  useEffect(() => {
    const fetchData = async () => {
      setLoading(true);
      try {
        const churchData = await searchChurchById(id);
        setChurch(churchData);

        const response = await fetch(
          `https://iglesia-tech-api.e2api.com/api/iglesiaTechApp/articulos/getArticulosByCategoryPage?page=1000&idCategoriaArticulo=0&idIglesia=${id}`
        );
        const data = await response.json();

        let articlesArray = [];
        if (data && Array.isArray(data.articulos)) {
          articlesArray = data.articulos;
        } else if (data && data.data && Array.isArray(data.data.articulos)) {
          articlesArray = data.data.articulos;
        }

        const filtered = articlesArray
          .filter(article => article.estatus === true)
          .sort((a, b) => new Date(b.publish_date) - new Date(a.publish_date));

        setArticles(filtered);
        setFilteredArticles(filtered);
        setCategories([...new Set(filtered.map(article => article.categoria))]);
      } catch (error) {
        console.error("❌ Error fetching articles:", error);
        setArticles([]);
        setFilteredArticles([]);
        setCategories([]);
      }
      setLoading(false);
    };

    fetchData();
  }, [id]);

  const handleSearch = (event) => {
    setSearchTerm(event.target.value);
    filterArticles(event.target.value, selectedCategories);
  };

  const handleCategoryChange = (selectedOptions) => {
    const selectedCategories = selectedOptions ? selectedOptions.map(option => option.value) : [];
    setSelectedCategories(selectedCategories);
    filterArticles(searchTerm, selectedCategories);
  };

  const filterArticles = (search, categories) => {
    let filtered = articles;
    if (search) {
      filtered = filtered.filter(article =>
        article.titulo.toLowerCase().includes(search.toLowerCase())
      );
    }
    if (categories.length > 0) {
      filtered = filtered.filter(article => categories.includes(article.categoria));
    }
    setFilteredArticles(filtered);
  };

  const loadMore = () => {
    setLoadingMore(true);
    setTimeout(() => {
      setVisibleCount(prev => prev + 7);
      setLoadingMore(false);
    }, 1000); // Simulate loading time
  };

  const handleBack = () => {
    setLoading(true);
    navigate(-1);
  };

  const handleArticleClick = (articleId) => {
    navigate(`/church/${id}/articles/${articleId}`);
  };

  return (
    <div style={commonStyles.container}>
      <div style={commonStyles.banner}>
        {loading ? <Skeleton height={200} /> : church?.portadaArticulos ? (
          <img src={`https://iglesia-tech-api.e2api.com${church.portadaArticulos}`} alt="Church Banner" style={commonStyles.bannerImage} />
        ) : <Skeleton height={200} />}
      </div>

      <div style={commonStyles.logoContainer} onClick={() => setTapCount(prev => prev + 1)}>
        {loading ? <Skeleton circle height={90} width={90} /> : church?.Logo ? (
          <img src={`https://iglesia-tech-api.e2api.com${church.Logo}`} alt="Church Logo" style={commonStyles.logo} />
        ) : <Skeleton circle height={90} width={90} />}
      </div>

      <button onClick={handleBack} style={commonStyles.backButton}>⬅ Volver</button>
      <h2 style={commonStyles.title}>📰 Church Articles</h2>

      <input
        type="text"
        placeholder="Buscar artículos..."
        value={searchTerm}
        onChange={handleSearch}
        style={styles.searchBar}
      />

      <div style={styles.selectContainer}>
        <Select
          isMulti
          options={categories.map(category => ({ value: category, label: category }))}
          value={selectedCategories.map(category => ({ value: category, label: category }))}
          onChange={handleCategoryChange}
          styles={{
            control: (base) => ({
              ...base,
              ...styles.selectDropdown,
            }),
          }}
          placeholder="Seleccionar categorías..."
        />
      </div>

      <div style={commonStyles.sectionContainer}>
        {loading ? (
          <Skeleton count={4} />
        ) : filteredArticles.length > 0 ? (
          <div style={styles.grid}>
            {filteredArticles.slice(0, visibleCount).map((article) => {
              const imageUrl = article.slider || article.slider_v2 || article.thumbnail || "https://via.placeholder.com/300";

              return (
                <div key={article.idArticulo} style={styles.articleCard} onClick={() => handleArticleClick(article.idArticulo)}>
                  <img src={imageUrl} alt={article.titulo} style={styles.articleImage} />
                  <h3>{article.titulo}</h3>
                  <p><strong>Categoría:</strong> {article.categoria}</p>
                </div>
              );
            })}
          </div>
        ) : (
          <p>No hay artículos disponibles.</p>
        )}
      </div>

      {visibleCount < filteredArticles.length && (
        <div>
          {loadingMore ? (
            <Skeleton height={40} width={200} style={{ margin: '20px auto' }} />
          ) : (
            <button onClick={loadMore} style={styles.loadMoreButton}>Cargar más</button>
          )}
        </div>
      )}
    </div>
  );
};

export default ArticlesPage;