import React, { useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { useAuth } from "../contexts/AuthContext";
import { addDoc, collection, getDocs } from "firebase/firestore";
import { toast } from "react-toastify";
import { db } from "../firebase";
import ChurchHeader from "./ChurchHeader";
import commonStyles from "../pages/commonStyles";

const formatPhoneNumber = (value) => {
  if (!value) return value;

  const phoneNumber = value.replace(/[^\d]/g, "");

  if (phoneNumber.length < 4) return phoneNumber;
  if (phoneNumber.length < 7) {
    return `(${phoneNumber.slice(0, 3)})${phoneNumber.slice(3)}`;
  }

  return `(${phoneNumber.slice(0, 3)})${phoneNumber.slice(3, 6)}-${phoneNumber.slice(6, 10)}`;
};

const normalizePhoneDigits = (value) => String(value || "").replace(/\D/g, "");

const toWhatsAppNumber = (value) => {
  const digits = normalizePhoneDigits(value);
  if (!digits) return "";
  if (digits.length === 10) return `1${digits}`;
  return digits;
};

const escapeVCardText = (value) => String(value || "").replace(/,/g, "\\,").replace(/;/g, "\\;").replace(/\n/g, " ");

const EvangelismOutreach = () => {
  const { id } = useParams();
  const { user } = useAuth();
  const [contacts, setContacts] = useState([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [form, setForm] = useState({
    firstName: "",
    lastName: "",
    phone: "",
    dateMet: "",
  });

  const routePrefix = (typeof window !== "undefined" && window.location?.pathname?.includes("/church/"))
    ? "/church"
    : "/organization";

  useEffect(() => {
    const fetchContacts = async () => {
      if (!id) {
        setContacts([]);
        return;
      }

      try {
        setLoading(true);
        const contactsRef = collection(db, `churches/${id}/evangelismOutreachContacts`);
        const snapshot = await getDocs(contactsRef);
        const list = snapshot.docs.map((contactDoc) => ({
          id: contactDoc.id,
          ...contactDoc.data(),
        }));

        list.sort((a, b) => {
          const aDate = a?.dateMet ? new Date(a.dateMet).getTime() : 0;
          const bDate = b?.dateMet ? new Date(b.dateMet).getTime() : 0;
          return bDate - aDate;
        });

        setContacts(list);
      } catch (error) {
        console.error("Error loading outreach contacts:", error);
        toast.error("Failed to load outreach contacts");
      } finally {
        setLoading(false);
      }
    };

    fetchContacts();
  }, [id]);

  const handleInputChange = (event) => {
    const { name, value } = event.target;

    setForm((prev) => {
      if (name === "phone") {
        const cleaned = value.replace(/[^\d\s()-]/g, "");
        return {
          ...prev,
          phone: formatPhoneNumber(cleaned),
        };
      }

      return {
        ...prev,
        [name]: value,
      };
    });
  };

  const handleAddContact = async (event) => {
    event.preventDefault();

    const firstName = form.firstName.trim();
    const lastName = form.lastName.trim();
    const phone = form.phone.trim();
    const dateMet = form.dateMet;
    const phoneDigits = phone.replace(/\D/g, "");

    if (!firstName || !lastName || !phone || !dateMet) {
      toast.error("Please complete first name, last name, phone, and date met");
      return;
    }

    if (phoneDigits.length < 7) {
      toast.error("Please enter a valid phone number");
      return;
    }

    const payload = {
      firstName,
      lastName,
      phone,
      dateMet,
      fullName: `${firstName} ${lastName}`.trim(),
      createdAt: new Date().toISOString(),
      createdBy: {
        uid: user?.uid || "unknown",
        displayName: user?.displayName || user?.email || "Unknown",
      },
    };

    try {
      setSaving(true);
      const newDoc = await addDoc(collection(db, `churches/${id}/evangelismOutreachContacts`), payload);
      setContacts((prev) => [{ id: newDoc.id, ...payload }, ...prev]);
      setForm({
        firstName: "",
        lastName: "",
        phone: "",
        dateMet: "",
      });
      toast.success("Outreach contact added");
    } catch (error) {
      console.error("Error adding outreach contact:", error);
      toast.error("Failed to add outreach contact");
    } finally {
      setSaving(false);
    }
  };

  const handleSaveContact = (contact) => {
    const firstName = String(contact?.firstName || "").trim();
    const lastName = String(contact?.lastName || "").trim();
    const fullName = `${firstName} ${lastName}`.trim() || "Outreach Contact";
    const phoneDigits = normalizePhoneDigits(contact?.phone || "");

    if (!phoneDigits) {
      toast.error("This contact does not have a valid phone number");
      return;
    }

    const vCard = [
      "BEGIN:VCARD",
      "VERSION:3.0",
      `N:${escapeVCardText(lastName)};${escapeVCardText(firstName)};;;`,
      `FN:${escapeVCardText(fullName)}`,
      `TEL;TYPE=CELL:${phoneDigits}`,
      contact?.dateMet ? `NOTE:Met on ${escapeVCardText(contact.dateMet)} (Evangelism Outreach)` : "NOTE:Evangelism Outreach contact",
      "END:VCARD",
    ].join("\r\n");

    const blob = new Blob([vCard], { type: "text/vcard;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `${fullName.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "") || "outreach-contact"}.vcf`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  const filteredContacts = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    if (!query) return contacts;

    return contacts.filter((contact) => {
      const fullName = `${contact?.firstName || ""} ${contact?.lastName || ""}`.toLowerCase();
      const phone = String(contact?.phone || "").toLowerCase();
      const dateMet = String(contact?.dateMet || "").toLowerCase();
      return fullName.includes(query) || phone.includes(query) || dateMet.includes(query);
    });
  }, [contacts, searchQuery]);

  return (
    <div style={{ ...commonStyles.fullWidthContainer, position: "relative" }}>
      <Link to={`${routePrefix}/${id}/mi-organizacion`} style={commonStyles.backButtonLink}>
        ← Back to Mi Organizacion
      </Link>

      <ChurchHeader id={id} applyShadow={false} />

      <div style={{ marginTop: "1.5rem" }}>
        <h1 style={{ marginBottom: "0.5rem", fontSize: "1.75rem", fontWeight: 700 }}>
          Evangelism Outreach
        </h1>
        <p style={{ marginTop: 0, color: "#6B7280", marginBottom: "1rem" }}>
          Add people you met and keep a searchable outreach contact list.
        </p>

        <div
          style={{
            padding: "1.25rem",
            border: "1px solid #E5E7EB",
            borderRadius: "12px",
            backgroundColor: "#FFFFFF",
            boxShadow: "0 4px 10px rgba(15, 23, 42, 0.04)",
          }}
        >
          <form
            onSubmit={handleAddContact}
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
              gap: "0.75rem",
              alignItems: "end",
              marginBottom: "1rem",
            }}
          >
            <div>
              <label style={{ display: "block", marginBottom: "4px", fontSize: "14px", fontWeight: 500, color: "#374151" }}>
                First Name
              </label>
              <input
                name="firstName"
                type="text"
                value={form.firstName}
                onChange={handleInputChange}
                placeholder="First name"
                style={{ width: "100%", padding: "10px", borderRadius: "8px", border: "1px solid #E5E7EB" }}
                required
              />
            </div>

            <div>
              <label style={{ display: "block", marginBottom: "4px", fontSize: "14px", fontWeight: 500, color: "#374151" }}>
                Last Name
              </label>
              <input
                name="lastName"
                type="text"
                value={form.lastName}
                onChange={handleInputChange}
                placeholder="Last name"
                style={{ width: "100%", padding: "10px", borderRadius: "8px", border: "1px solid #E5E7EB" }}
                required
              />
            </div>

            <div>
              <label style={{ display: "block", marginBottom: "4px", fontSize: "14px", fontWeight: 500, color: "#374151" }}>
                Phone Number
              </label>
              <input
                name="phone"
                type="tel"
                value={form.phone}
                onChange={handleInputChange}
                placeholder="(123)456-7890"
                maxLength="13"
                style={{ width: "100%", padding: "10px", borderRadius: "8px", border: "1px solid #E5E7EB" }}
                required
              />
            </div>

            <div>
              <label style={{ display: "block", marginBottom: "4px", fontSize: "14px", fontWeight: 500, color: "#374151" }}>
                Date Met
              </label>
              <input
                name="dateMet"
                type="date"
                value={form.dateMet}
                onChange={handleInputChange}
                style={{ width: "100%", padding: "10px", borderRadius: "8px", border: "1px solid #E5E7EB" }}
                required
              />
            </div>

            <div>
              <button
                type="submit"
                disabled={saving}
                style={{
                  width: "100%",
                  padding: "10px 14px",
                  borderRadius: "8px",
                  border: "none",
                  backgroundColor: saving ? "#94A3B8" : "#2563EB",
                  color: "white",
                  fontWeight: 600,
                  cursor: saving ? "not-allowed" : "pointer",
                }}
              >
                {saving ? "Saving..." : "Add Contact"}
              </button>
            </div>
          </form>

          <div style={{ marginBottom: "0.75rem" }}>
            <input
              type="text"
              value={searchQuery}
              onChange={(event) => setSearchQuery(event.target.value)}
              placeholder="Search by name, phone, or date (YYYY-MM-DD)"
              style={{ width: "100%", padding: "10px", borderRadius: "8px", border: "1px solid #E5E7EB" }}
            />
          </div>

          <div style={{ color: "#6B7280", fontSize: "0.9rem", marginBottom: "0.5rem" }}>
            {loading ? "Loading contacts..." : `${filteredContacts.length} of ${contacts.length} contact(s)`}
          </div>

          {!loading && filteredContacts.length === 0 ? (
            <div style={{ color: "#6B7280", padding: "0.5rem 0" }}>
              {contacts.length === 0
                ? "No outreach contacts yet. Add your first contact above."
                : "No contacts match your search."}
            </div>
          ) : (
            <div style={{ display: "grid", gap: "0.6rem" }}>
              {filteredContacts.map((contact) => (
                (() => {
                  const whatsappNumber = toWhatsAppNumber(contact.phone);
                  return (
                    <div
                      key={contact.id}
                      style={{
                        border: "1px solid #E5E7EB",
                        borderRadius: "10px",
                        padding: "0.75rem",
                        display: "grid",
                        gridTemplateColumns: "2fr 1.2fr 1fr auto",
                        gap: "0.75rem",
                        alignItems: "center",
                      }}
                    >
                      <div style={{ fontWeight: 600, color: "#111827" }}>
                        {(contact.firstName || "").trim()} {(contact.lastName || "").trim()}
                      </div>
                      <a
                        href={`tel:${String(contact.phone || "").replace(/[^\d+]/g, "")}`}
                        style={{ color: "#2563EB", textDecoration: "none", fontWeight: 500 }}
                      >
                        {contact.phone}
                      </a>
                      <div style={{ color: "#475569", fontSize: "0.9rem", textAlign: "right" }}>
                        {contact.dateMet || "-"}
                      </div>
                      <div style={{ display: "flex", gap: "8px", justifyContent: "flex-end", flexWrap: "wrap" }}>
                        {whatsappNumber && (
                          <a
                            href={`https://wa.me/${whatsappNumber}?text=${encodeURIComponent(`Hi ${(contact.firstName || "").trim()}, this is ${user?.displayName || "from church"}.`)}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            style={{
                              padding: "6px 10px",
                              borderRadius: "6px",
                              backgroundColor: "#22C55E",
                              color: "white",
                              textDecoration: "none",
                              fontSize: "0.82rem",
                              fontWeight: 600,
                            }}
                          >
                            WhatsApp
                          </a>
                        )}
                        <button
                          type="button"
                          onClick={() => handleSaveContact(contact)}
                          style={{
                            padding: "6px 10px",
                            borderRadius: "6px",
                            backgroundColor: "#0EA5E9",
                            color: "white",
                            border: "none",
                            cursor: "pointer",
                            fontSize: "0.82rem",
                            fontWeight: 600,
                          }}
                        >
                          Save Contact
                        </button>
                      </div>
                    </div>
                  );
                })()
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default EvangelismOutreach;
