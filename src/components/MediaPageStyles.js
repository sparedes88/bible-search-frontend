export const customSelectStyles = {
  container: (provided) => ({
    ...provided,
    marginTop: "20px",
    width: "100%",
    maxWidth: "600px",
    margin: "auto",
  }),
  control: (provided) => ({
    ...provided,
    borderRadius: "5px",
    border: "1px solid #ccc",
    padding: "5px",
  }),
  multiValue: (provided) => ({
    ...provided,
    backgroundColor: "#007bff",
    color: "white",
  }),
  multiValueLabel: (provided) => ({
    ...provided,
    color: "white",
  }),
  multiValueRemove: (provided) => ({
    ...provided,
    color: "white",
    ':hover': {
      backgroundColor: "#0056b3",
      color: "white",
    },
  }),
};

export const commonStyles = {
  container: {
    maxWidth: "800px",
    margin: "auto",
    padding: "20px",
    fontFamily: "'Nunito', sans-serif",
    textAlign: "center",
  },
  banner: {
    marginBottom: "20px",
  },
  bannerImage: {
    width: "100%",
    height: "auto",
  },
  logoContainer: {
    display: "flex",
    justifyContent: "center",
    marginBottom: "20px",
  },
  logo: {
    width: "90px",
    height: "90px",
    borderRadius: "50%",
  },
  searchContainer: {
    marginBottom: "20px",
  },
  cardsContainer: {
    display: "flex",
    flexWrap: "wrap",
    gap: "20px",
    justifyContent: "center",
  },
  card: {
    width: "300px",
    border: "1px solid #ccc",
    borderRadius: "8px",
    overflow: "hidden",
    boxShadow: "0px 4px 6px rgba(0,0,0,0.1)",
  },
  cardImage: {
    width: "100%",
    height: "200px",
    objectFit: "cover",
  },
  cardContent: {
    padding: "15px",
    textAlign: "left",
  },
};