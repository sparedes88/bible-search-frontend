import React, { useEffect, useState } from "react";
import { db } from "../firebase"; // Import Firebase Firestore
import { collection, getDocs } from "firebase/firestore"; // Import Firestore functions

const ChurchSync = () => {
  const [churches, setChurches] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchChurches = async () => {
      setLoading(true);
      try {
        // Fetch churches collection from Firebase
        const churchesRef = collection(db, "churches");
        const querySnapshot = await getDocs(churchesRef);
        const churchesData = querySnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
        setChurches(churchesData);
      } catch (error) {
        console.error("❌ Error fetching churches:", error);
      }
      setLoading(false);
    };

    fetchChurches();
  }, []);

  return (
    <div style={styles.container}>
      <h2 style={styles.title}>Church Sync</h2>
      {loading ? (
        <p>Loading churches...</p>
      ) : (
        <table style={styles.table}>
          <thead>
            <tr>
              <th style={styles.th}>Church ID</th>
            </tr>
          </thead>
          <tbody>
            {churches.map(church => (
              <tr key={church.id}>
                <td style={styles.td}>{church.churchId}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
};

// Styles object
const styles = {
  container: {
    maxWidth: "600px",
    margin: "auto",
    padding: "20px",
    fontFamily: "'Nunito', sans-serif",
    textAlign: "center",
  },
  title: {
    fontSize: "24px",
    fontWeight: "700",
    marginBottom: "20px",
  },
  table: {
    width: "100%",
    borderCollapse: "collapse",
  },
  th: {
    backgroundColor: "#007bff",
    color: "white",
    padding: "10px",
  },
  td: {
    padding: "8px",
    borderBottom: "1px solid #ddd",
  },
};

export default ChurchSync;