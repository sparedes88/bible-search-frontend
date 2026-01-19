/** @license, { useEffect, useState } from "react";
 *port { useParams, useNavigate } from "react-router-dom";
 * jsPDF - PDF Document creation from JavaScript
 *port "react-loading-skeleton/dist/skeleton.css";
 * Copyright (c) 2010-2021 James Hall <james@parall.ax>, https://github.com/MrRio/jsPDF
 *               2015-2021 yWorks GmbH, http://www.yworks.com
 *               2015-2021 Lukas Holländer <lukas.hollaender@yworks.com>, https://github.com/HackbrettXXX
 *               2016-2018 Aras Abbasi <aras.abbasi@gmail.com>
 *               2018 Amber Schühmacher <https://github.com/amberjs>
 *               2018 Kevin Gonnord <https://github.com/lleios>
 *               2018 Jackie Weng <https://github.com/jemerald>
 *               2010 Aaron Spike, https://github.com/acspike
 *               2012 Willow Systems Corporation, https://github.com/willowsystems
 *               2012 Pablo Hess, https://github.com/pablohess
 *               2012 Florian Jenett, https://github.com/fjenett
 *               2013 Warren Weckesser, https://github.com/warrenweckesser
 *               2013 Youssef Beddad, https://github.com/lifof
 *               2013 Lee Driscoll, https://github.com/lsdriscoll
 *               2013 Stefan Slonevskiy, https://github.com/stefslon
 *               2013 Jeremy Morel, https://github.com/jmorel
 *               2013 Christoph Hartmann, https://github.com/chris-rock
 *               2014 Juan Pablo Gaviria, https://github.com/juanpgaviria
 *               2014 James Makes, https://github.com/dollaruwpp/articulos/getArticulosByCategoryPage?page=1000&idCategoriaArticulo=0&idIglesia=${id}`
 *               2014 Diego Casorran, https://github.com/diegocr
 *               2014 Steven Spungin, https://github.com/Flamenco
 *               2014 Kenneth Glassey, https://github.com/Gavversa.data?.articulos || [];
 *      const foundArticle = articlesArray.find((a) => a.idArticulo === parseInt(articleId));
 * Permission is hereby granted, free of charge, to any person obtaining
 * a copy of this software and associated documentation files (the
 * "Software"), to deal in the Software without restriction, including
 * without limitation the rights to use, copy, modify, merge, publish,
 * distribute, sublicense, and/or sell copies of the Software, and tosias/getIglesiaById?idIglesia=${id}`
 * permit persons to whom the Software is furnished to do so, subject to
 * the following conditions:wait churchResponse.json();
 *      setChurch(churchData);
 * The above copyright notice and this permission notice shall be
 * included in all copies or substantial portions of the Software.
 *      console.log("🏛 Church Data:", churchData);
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND,
 * EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF
 * MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND
 * NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE
 * LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION
 * OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION
 * WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
 *}, [id, articleId]);
 * Contributor(s):
 *    siefkenj, ahwolf, rickygu, Midnith, saintclair, eaparango,
 *    kim3er, mfo, alnorth, Flamenco
 */;

import React, { useEffect, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import Skeleton from "react-loading-skeleton";
import "react-loading-skeleton/dist/skeleton.css";
import { jsPDF } from "jspdf"; // ✅ PDF Export
import "jspdf-autotable";
import { FaFacebook, FaWhatsapp, FaSms, FaFilePdf } from "react-icons/fa"; // ✅ Social Icons
import commonStyles from "./commonStyles";

const ArticlePageDetail = () => {
  const { id, articleId } = useParams();
  const navigate = useNavigate();
  const [article, setArticle] = useState(null);
  const [church, setChurch] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchArticleAndChurch = async () => {
      setLoading(true);
      try {
        // Fetch Article Data
        const articleResponse = await fetch(
          `https://iglesia-tech-api.e2api.com/api/iglesiaTechApp/articulos/getArticulosByCategoryPage?page=1000&idCategoriaArticulo=0&idIglesia=${id}`
        );
        const articleData = await articleResponse.json();
        const articlesArray = articleData.articulos || articleData.data?.articulos || [];
        const foundArticle = articlesArray.find((a) => a.idArticulo === parseInt(articleId));
        setArticle(foundArticle);

        // Fetch Church Data
        const churchResponse = await fetch(
          `https://iglesia-tech-api.e2api.com/api/iglesiaTechApp/iglesias/getIglesiaById?idIglesia=${id}`
        );
        const churchData = await churchResponse.json();
        setChurch(churchData);

        console.log("📜 Article Data:", foundArticle);
        console.log("🏛 Church Data:", churchData);
      } catch (error) {
        console.error("❌ Error fetching data:", error);
      }
      setLoading(false);
    };

    fetchArticleAndChurch();
  }, [id, articleId]);

  const handleBack = () => {
    navigate(-1);
  };

  if (loading) {
    return (
      <div style={commonStyles.container}>
        <Skeleton height={200} />
        <Skeleton count={4} />
      </div>
    );
  }

  if (!article) {
    return <p>❌ Artículo no encontrado.</p>;
  }

  // ✅ Determine the Best Banner Image
  const articleImage = article.slider || article.slider_v2 || article.thumbnail;
  const churchBanner = church?.portadaArticulos ? `https://iglesia-tech-api.e2api.com${church.portadaArticulos}` : null;
  const fallbackImage = "https://via.placeholder.com/600x300"; // Placeholder image if missing
  const bannerImage = articleImage ? articleImage : churchBanner ? churchBanner : fallbackImage;

  // ✅ Church Logo
  const churchLogo = church?.Logo ? `https://iglesia-tech-api.e2api.com${church.Logo}` : null;

  // ✅ Export Article as PDF
  const exportToPDF = async () => {
    const doc = new jsPDF();
    let pageWidth = doc.internal.pageSize.getWidth();
    let yPosition = 20;

    // Centered Church Logo
    if (churchLogo) {
      const base64Logo = await getBase64Image(churchLogo);
      if (base64Logo) {
        const logoWidth = 50;
        const logoX = (pageWidth - logoWidth) / 2;
        doc.addImage(base64Logo, "JPEG", logoX, yPosition, logoWidth, 50);
        yPosition += 60;
      }
    }

    // Centered Article Title
    doc.setFontSize(20);
    doc.text(article.titulo, pageWidth / 2, yPosition, { align: "center" });
    yPosition += 15;

    // Centered Article Banner
    if (bannerImage) {
      const base64Banner = await getBase64Image(bannerImage);
      if (base64Banner) {
        const imgWidth = 170;
        const imgX = (pageWidth - imgWidth) / 2;
        doc.addImage(base64Banner, "JPEG", imgX, yPosition, imgWidth, 80);
        yPosition += 90;
      }
    }

    // Article Content
    doc.setFontSize(12);
    const text = article.contenido.map(item => item.text || item.value || "No content available").join("\n\n");
    doc.text(text, 20, yPosition, { maxWidth: 170 });

    // Save PDF
    doc.save(`${article.titulo}.pdf`);
  };

  // ✅ Convert Image URLs to Base64 for PDF
  const getBase64Image = async (imgUrl) => {
    if (!imgUrl) return null;
    try {
      const response = await fetch(imgUrl, { mode: "cors" });
      const blob = await response.blob();
      return new Promise((resolve) => {
        const reader = new FileReader();
        reader.onloadend = () => resolve(reader.result);
        reader.readAsDataURL(blob);
      });
    } catch (error) {
      console.error("❌ Error loading image:", imgUrl, error);
      return null;
    }
  };

  // ✅ Social Sharing Links
  const pageUrl = window.location.href;
  const facebookShareUrl = `https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(pageUrl)}`;
  const whatsappShareUrl = `https://api.whatsapp.com/send?text=${encodeURIComponent(article.titulo + " " + pageUrl)}`;
  const smsShareUrl = `sms:?body=${encodeURIComponent(article.titulo + " " + pageUrl)}`;

  return (
    <div style={commonStyles.container}>
      {/* Full-Sized Banner (Article Image with Church Banner Fallback) */}
      <div style={styles.bannerContainer}>
        <img src={bannerImage} alt="Article Banner" style={styles.bannerImage} />
      </div>

      {/* Back Button */}
      <button onClick={handleBack} style={commonStyles.backButton}>⬅ Volver</button>

      {/* Article Title */}
      <h2 style={commonStyles.title}>{article.titulo}</h2>

      {/* Article Content */}
      <div style={commonStyles.articleContent}>
        {article.contenido && Array.isArray(article.contenido) ? (
          article.contenido.map((item, index) => (
            <div key={index} dangerouslySetInnerHTML={{ __html: item.text || item.value || JSON.stringify(item) }} />
          ))
        ) : (
          <p>{article.contenido}</p>
        )}
      </div>

      {/* ✅ Export to PDF & Share Buttons */}
      <div style={styles.buttonContainer}>
        <button onClick={exportToPDF} style={styles.pdfButton}>
          <FaFilePdf /> Exportar PDF
        </button>

        <a href={facebookShareUrl} target="_blank" rel="noopener noreferrer" style={styles.shareButton}>
          <FaFacebook /> Compartir en Facebook
        </a>

        <a href={whatsappShareUrl} target="_blank" rel="noopener noreferrer" style={styles.shareButton}>
          <FaWhatsapp /> Compartir en WhatsApp
        </a>

        <a href={smsShareUrl} style={styles.shareButton}>
          <FaSms /> Compartir por SMS
        </a>
      </div>
    </div>
  );
};

// ✅ Define Styles
const styles = {
  bannerContainer: {
    width: "100%",
    maxHeight: "500px",
    overflow: "hidden",
    display: "flex",
    justifyContent: "center",
    alignItems: "center",
    backgroundColor: "#f0f0f0",
  },
  bannerImage: {
    width: "100%",
    height: "auto",
    objectFit: "contain",
  },
  buttonContainer: {
    display: "flex",
    justifyContent: "center",
    gap: "10px",
    marginTop: "20px",
  },
  pdfButton: {
    padding: "10px 15px",
    backgroundColor: "#d32f2f",
    color: "white",
    border: "none",
    borderRadius: "5px",
    cursor: "pointer",
    display: "flex",
    alignItems: "center",
    gap: "5px",
  },
  shareButton: {
    padding: "10px 15px",
    backgroundColor: "#1877f2",
    color: "white",
    borderRadius: "5px",
    textDecoration: "none",
    display: "flex",
    alignItems: "center",
    gap: "5px",
  },
};

export default ArticlePageDetail;