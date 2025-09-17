import React, { useEffect, useState } from "react";
import { db } from "../firebase";
import { doc, getDoc } from "firebase/firestore";

const FreshBooksInvoices = ({ churchId }) => {
  const [invoices, setInvoices] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    const fetchInvoices = async () => {
      setLoading(true);
      setError("");
      try {
        // Get FreshBooks token from Firestore
        const churchDoc = await getDoc(doc(db, "churches", churchId));
        const data = churchDoc.data();
        if (!data || !data.freshbooksToken) {
          setError("No FreshBooks token found for this church.");
          setLoading(false);
          return;
        }
        // Fetch invoices from FreshBooks API
        const res = await fetch("https://api.freshbooks.com/accounting/account/me/invoices/invoices", {
          headers: {
            Authorization: `Bearer ${data.freshbooksToken}`,
            "Content-Type": "application/json",
          },
        });
        const result = await res.json();
        if (result && result.response && result.response.result && result.response.result.invoices) {
          setInvoices(result.response.result.invoices);
        } else {
          setError("No invoices found or error in response.");
        }
      } catch (err) {
        setError("Error fetching invoices: " + err.message);
      }
      setLoading(false);
    };
    fetchInvoices();
  }, [churchId]);

  if (loading) return <div>Loading invoices...</div>;
  if (error) return <div style={{ color: "red" }}>{error}</div>;

  return (
    <div style={{ margin: "2rem 0" }}>
      <h3>FreshBooks Invoices</h3>
      <table style={{ width: "100%", borderCollapse: "collapse" }}>
        <thead>
          <tr style={{ background: "#f3f4f6" }}>
            <th style={{ padding: "0.5rem", border: "1px solid #e5e7eb" }}>Invoice #</th>
            <th style={{ padding: "0.5rem", border: "1px solid #e5e7eb" }}>Client</th>
            <th style={{ padding: "0.5rem", border: "1px solid #e5e7eb" }}>Total</th>
            <th style={{ padding: "0.5rem", border: "1px solid #e5e7eb" }}>Status</th>
          </tr>
        </thead>
        <tbody>
          {invoices.map(inv => (
            <tr key={inv.invoiceid}>
              <td style={{ padding: "0.5rem", border: "1px solid #e5e7eb" }}>{inv.invoice_number}</td>
              <td style={{ padding: "0.5rem", border: "1px solid #e5e7eb" }}>{inv.client && inv.client.organization || "-"}</td>
              <td style={{ padding: "0.5rem", border: "1px solid #e5e7eb" }}>${inv.amount && inv.amount.amount || "0.00"}</td>
              <td style={{ padding: "0.5rem", border: "1px solid #e5e7eb" }}>{inv.status}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
};

export default FreshBooksInvoices;
