import React, { useState, useEffect } from "react";
import { collection, addDoc, getDocs, query, where } from "firebase/firestore";
import { db } from "../firebase";

const AddField = () => {
  const [inputValue, setInputValue] = useState("");
  const [existingValues, setExistingValues] = useState([]);
  const [message, setMessage] = useState("");

  useEffect(() => {
    // ✅ Fetch existing values from Firestore on component mount
    const fetchExistingValues = async () => {
      try {
        const q = query(collection(db, "options"));
        const querySnapshot = await getDocs(q);
        const values = querySnapshot.docs.map(doc => doc.data().name);
        setExistingValues(values);
      } catch (error) {
        console.error("❌ Error fetching existing values:", error);
      }
    };

    fetchExistingValues();
  }, []);

  const handleCreateOption = async () => {
    if (!inputValue.trim()) {
      setMessage("❌ Error: No puedes agregar un valor vacío.");
      return;
    }

    try {
      // ✅ Check if the value already exists
      const q = query(collection(db, "options"), where("name", "==", inputValue));
      const querySnapshot = await getDocs(q);

      if (!querySnapshot.empty) {
        setMessage("❌ Error: Este valor ya existe en la base de datos.");
        return;
      }

      // ✅ Add new value to Firestore
      await addDoc(collection(db, "options"), { name: inputValue });
      setMessage("✅ Opción agregada con éxito.");

      // ✅ Update UI with new value
      setExistingValues([...existingValues, inputValue]);
      setInputValue(""); // Clear input field

    } catch (error) {
      console.error("❌ Error adding document:", error);
      setMessage("❌ Error al agregar el valor.");
    }
  };

  return (
    <div>
      <h2>Agregar Opción</h2>
      <input
        type="text"
        placeholder="Ingrese una opción..."
        value={inputValue}
        onChange={(e) => setInputValue(e.target.value)}
      />
      <button onClick={handleCreateOption}>Agregar</button>

      {message && <p style={{ color: message.includes("Error") ? "red" : "green" }}>{message}</p>}

      <h3>Opciones Existentes:</h3>
      <ul>
        {existingValues.map((value, index) => (
          <li key={index}>{value}</li>
        ))}
      </ul>
    </div>
  );
};

export default AddField;
