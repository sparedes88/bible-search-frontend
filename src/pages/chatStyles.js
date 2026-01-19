const chatStyles = {
  container: {
    padding: "20px",
    maxWidth: "600px",
    margin: "0 auto",
    display: "flex",
    flexDirection: "column",
    height: "100vh",
    fontFamily: "'Nunito', sans-serif",
    textAlign: "left",
    backgroundColor: "#ffffff",
    borderRadius: "8px",
    boxShadow: "0px 4px 8px rgba(0, 0, 0, 0.05)",
  },
  backButton: {
    backgroundColor: "#007bff",
    color: "#fff",
    border: "none",
    padding: "10px 20px",
    borderRadius: "5px",
    cursor: "pointer",
    marginBottom: "20px",
    textAlign: "left",
    display: "block",
  },
  chatContainer: {
    flex: 1,
    overflowY: "auto",
    marginBottom: "20px",
    padding: "10px",
    backgroundColor: "#f8f8f8",
    borderRadius: "5px",
    scrollbarWidth: "none", // For Firefox
    msOverflowStyle: "none", // For Internet Explorer and Edge
  },
  chatContainerHiddenScrollbar: {
    display: "none", // For Chrome, Safari, and Opera
  },
  myMessage: {
    padding: "10px",
    margin: "10px 0",
    backgroundColor: "#dcf8c6",
    borderRadius: "5px",
    alignSelf: "flex-end",
    maxWidth: "80%",
  },
  otherMessage: {
    padding: "10px",
    margin: "10px 0",
    backgroundColor: "#fff",
    borderRadius: "5px",
    alignSelf: "flex-start",
    maxWidth: "80%",
  },
  timestamp: {
    fontSize: "0.8em",
    color: "#888",
    textAlign: "right",
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
  unreadDivider: {
    position: "relative",
    textAlign: "center",
    margin: "20px 0",
    borderBottom: "1px solid #e0e0e0",
    "& span": {
      backgroundColor: "#f8f8f8",
      padding: "0 10px",
      color: "#666",
      fontSize: "0.9em",
      position: "relative",
      top: "10px",
    }
  },
};

export default chatStyles;