const rawStyles = {
  container: {
    padding: "20px",
    maxWidth: "600px",
    margin: "20px auto",
    display: "flex",
    flexDirection: "column",
    fontFamily: "'Nunito', sans-serif",
    textAlign: "center",
    backgroundColor: "#ffffff",
    borderRadius: "8px",
    boxShadow: "0px 5px 20px rgba(0, 0, 0, 0.15)",
    "@media (max-width: 768px)": {
      padding: "15px",
      margin: "15px auto",
    },
    "@media (max-width: 480px)": {
      padding: "10px",
      margin: "10px auto",
      borderRadius: "4px",
    },
  },
  fullWidthContainer: {
    padding: "20px",
    width: "100%",
    maxWidth: "100%",
    margin: "0",
    display: "flex",
    flexDirection: "column",
    fontFamily: "'Nunito', sans-serif",
    textAlign: "center",
    backgroundColor: "#ffffff",
    "@media (max-width: 768px)": {
      padding: "15px",
    },
    "@media (max-width: 480px)": {
      padding: "10px",
    },
  },
  banner: {
    width: "100%",
    height: "auto",
    minHeight: "300px",
    backgroundSize: "cover",
    backgroundPosition: "center",
    borderRadius: "10px",
    overflow: "hidden",
    position: "relative",
  },
  bannerImage: {
    width: "100%",
    height: "auto",
    minHeight: "300px",
    maxHeight: "500px",
    objectFit: "cover",
    objectPosition: "center",
    borderRadius: "10px",
    display: "block",
  },
  logoContainer: {
    display: "flex",
    justifyContent: "center",
    marginTop: "-20px",
    cursor: "pointer",
  },
  logo: {
    width: "90px",
    height: "90px",
    borderRadius: "50%",
    border: "4px solid white",
    boxShadow: "0px 4px 6px rgba(0,0,0,0.2)",
  },
  backButton: {
    backgroundColor: "#007bff",
    width: "110px",
    color: "#fff",
    border: "none",
    padding: "10px 20px",
    borderRadius: "8px",
    cursor: "pointer",
    marginBottom: "20px",
    textAlign: "center",
  },
  backButtonLink: {
    backgroundColor: "#007bff",
    width: "200px",
    color: "#fff",
    border: "none",
    padding: "10px 10px",
    borderRadius: "8px",
    cursor: "pointer",
    marginBottom: "20px",
    textAlign: "center",
    textDecoration: "none",
  },
  indigoButton: {
    backgroundColor: '#4F46E5',
    color: "#fff",
    border: "none",
    padding: "10px 20px",
    borderRadius: "8px",
    cursor: "pointer",
    marginBottom: "20px",
    textAlign: "center",
    textDecoration: "none",
  },
  greenButton: {
    backgroundColor: '#188c1c',
    color: "#fff",
    border: "none",
    padding: "10px 20px",
    borderRadius: "8px",
    cursor: "pointer",
    marginBottom: "20px",
    textAlign: "center",
    textDecoration: "none",
  },
  orangeButton: {
    backgroundColor: '#F59E0B',
    color: "#fff",
    border: "none",
    padding: "10px 20px",
    borderRadius: "8px",
    cursor: "pointer",
    marginBottom: "20px",
    textAlign: "center",
    textDecoration: "none",
  },
  redButton: {
    backgroundColor: '#EF4444',
    color: "#fff",
    border: "none",
    padding: "10px 20px",
    borderRadius: "8px",
    cursor: "pointer",
    marginBottom: "20px",
    textAlign: "center",
    textDecoration: "none",
  },
  topBorder: {
    borderTop: "2px solid #e7e7e7",
    paddingTop: "20px",
  },
  editButton: {
    backgroundColor: "#4F46E5",
    width: "100%",
    color: "#fff",
    border: "none",
    padding: "10px 20px",
    borderRadius: "8px",
    cursor: "pointer",
    marginBottom: "20px",
    textAlign: "center",
  },
  logoutButton: {
    backgroundColor: "#007bff",
    width: "150px",
    color: "#fff",
    border: "none",
    padding: "10px 20px",
    borderRadius: "5px",
    cursor: "pointer",
    marginBottom: "20px",
    textAlign: "center",
  },
  addButton: {
    backgroundColor: "#007bff",
    width: "100%",
    color: "#fff",
    border: "none",
    padding: "10px 20px",
    borderRadius: "8px",
    cursor: "pointer",
    marginBottom: "20px",
    textAlign: "center",
  },
  confirmButton: {
    backgroundColor: "#53bf49",
    width: "100%",
    color: "#fff",
    border: "none",
    padding: "10px 20px",
    borderRadius: "8px",
    cursor: "pointer",
    textAlign: "center",
  },
  cancelButton: {
    backgroundColor: "#cc8733",
    width: "100%",
    color: "#fff",
    border: "none",
    padding: "10px 20px",
    borderRadius: "8px",
    cursor: "pointer",
    textAlign: "center",
  },
  title: {
    fontSize: "28px",
    fontWeight: "700",
    color: "#1f262e",
    "@media (max-width: 768px)": {
      fontSize: "24px",
    },
    "@media (max-width: 480px)": {
      fontSize: "20px",
    },
  },
  subTitle: {
    fontSize: "22px",
    fontWeight: "600",
    color: "#48596b",
    "@media (max-width: 768px)": {
      fontSize: "20px",
    },
    "@media (max-width: 480px)": {
      fontSize: "18px",
    },
  },
  sectionContainer: {
    padding: "15px",
    backgroundColor: "#f9f9f9",
    borderRadius: "10px",
    marginTop: "10px",
    textAlign: "left",
  },
  fullPageLoader: {
    display: "flex",
    flexDirection: "column",
    justifyContent: "center",
    alignItems: "center",
    height: "100vh",
    backgroundColor: "#ffffff",
  },
  chatContainer: {
    flex: 1,
    overflowY: "auto",
    marginBottom: "20px",
    padding: "10px",
    backgroundColor: "#f8f8f8",
    borderRadius: "5px",
  },
  message: {
    padding: "10px",
    margin: "10px 0",
    backgroundColor: "#e9ecef",
    borderRadius: "5px",
  },
  inputContainer: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
  },
  input: {
    flex: 1,
    padding: "10px",
    borderRadius: "5px",
    border: "1px solid #ccc",
    marginRight: "10px",
  },
  sendButton: {
    backgroundColor: "#007bff",
    color: "#fff",
    border: "none",
    padding: "10px 20px",
    borderRadius: "5px",
    cursor: "pointer",
  },
};

function mediaMatches(mediaKey) {
  if (typeof window === 'undefined') return false;
  const mq = mediaKey.replace('@media', '').trim();
  const maxMatch = mq.match(/max-width:\s*(\d+)px/);
  if (maxMatch) {
    const max = parseInt(maxMatch[1], 10);
    return window.innerWidth <= max;
  }
  const minMatch = mq.match(/min-width:\s*(\d+)px/);
  if (minMatch) {
    const min = parseInt(minMatch[1], 10);
    return window.innerWidth >= min;
  }
  return false;
}

function mergeMediaQueries(styles) {
  const out = {};
  for (const [key, value] of Object.entries(styles)) {
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      const base = {};
      const mediaBlocks = [];
      for (const [k, v] of Object.entries(value)) {
        if (k.startsWith('@media')) mediaBlocks.push([k, v]);
        else base[k] = v;
      }
      mediaBlocks.sort((a, b) => {
        const ax = (a[0].match(/max-width:\s*(\d+)px/) || [])[1] || 0;
        const bx = (b[0].match(/max-width:\s*(\d+)px/) || [])[1] || 0;
        return parseInt(bx, 10) - parseInt(ax, 10);
      });
      let mergedStyle = { ...base };
      for (const [mKey, mStyles] of mediaBlocks) {
        try {
          if (mediaMatches(mKey)) Object.assign(mergedStyle, mStyles);
        } catch (err) {
          // ignore
        }
      }
      out[key] = mergedStyle;
    } else {
      out[key] = value;
    }
  }
  return out;
}

const commonStyles = mergeMediaQueries(rawStyles);

export default commonStyles;
