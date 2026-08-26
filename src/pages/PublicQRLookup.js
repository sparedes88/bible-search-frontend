import React, { useEffect, useRef, useState } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import { QRCodeCanvas } from "qrcode.react";
import { getChurchData } from "../api/church";

const QR_LOOKUP_FUNCTION_URL = "https://us-central1-igletechv1.cloudfunctions.net/getMemberQrByPhone";
const COMMITMENT_SUMMARY_FUNCTION_URL = "https://us-central1-igletechv1.cloudfunctions.net/getMemberCommitmentSummary";

const TRANSLATIONS = {
  en: {
    back: "⬅ Back",
    title: "Get My QR Code",
    subtitle: "Enter the phone number on your profile to retrieve your check-in QR code.",
    phonePlaceholder: "Phone Number",
    submit: "Get My QR Code",
    submitting: "Searching...",
    invalidPhone: "Please enter a valid phone number.",
    notFound: "No member found with that phone number.",
    serverError: "Could not reach the server. Please try again.",
    idLabel: "ID:",
    saveContact: "👤 Save as Contact (iPhone & Android)",
    savedContactMessage: "Contact card downloaded — open it and tap \"Add to Contacts\" to save the QR code as a contact photo.",
    openScanner: "Open QR Scanner (staff login required)",
    commitmentTitle: "My Faithful Commitment",
    commitmentSubtitle: "How you're doing on each check-in task, with a little encouragement.",
    maturityTitle: "Spiritual maturity involves faithful commitment",
    maturityIntro: "There's a difference between being committed and being faithfully committed:",
    maturityPoints: [
      "Commitment shows up when it's convenient. Faithful commitment shows up consistently — even when it's hard (Luke 16:10).",
      "Commitment depends on how you feel in the moment. Faithful commitment is rooted in character, not feelings (1 Corinthians 4:2).",
      "Commitment often fades with time. Faithful commitment endures and grows through trials, producing spiritual maturity (James 1:2-4).",
    ],
    loadingText: "Loading...",
    noTasks: "No check-in tasks are set up for this organization yet.",
    sessionsCaption: (attended, expected, pct) => `${attended} / ${expected} expected sessions (${pct}%)`,
    checkInsNeededCaption: (attended, min, remaining) =>
      `${attended} of ${min} check-ins completed — ${remaining} more needed before your commitment can be evaluated.`,
    avgGapCaption: (d) => ` · avg. ${d}d between check-ins`,
    levels: {
      Faithful: "Faithful",
      Committed: "Committed",
      "Too Early to Evaluate": "Too Early to Evaluate",
      "Not Started": "Not Started",
    },
    feedback: {
      faithful: [
        {
          verse: "“Well done, good and faithful servant! You have been faithful over a little; I will set you over much. Enter into the joy of your master.” — Matthew 25:21",
          message: "You're showing up consistently, and it shows! Keep pressing on — your faithfulness is planting seeds that will bear fruit in due season.",
        },
        {
          verse: "“I have fought the good fight, I have finished the race, I have kept the faith.” — 2 Timothy 4:7",
          message: "You're running this race well. Stay the course — every faithful check-in is part of a story worth finishing strong.",
        },
        {
          verse: "“Be faithful unto death, and I will give you the crown of life.” — Revelation 2:10",
          message: "Your consistency is a testimony. Don't grow tired — the reward for faithfulness is far greater than the effort it takes.",
        },
      ],
      committed: [
        {
          verse: "“And let us not grow weary of doing good, for in due season we will reap, if we do not give up.” — Galatians 6:9",
          message: "You're engaged, but there's room to build a steadier rhythm. Try setting a reminder before each session — small, consistent steps build lasting faithfulness.",
        },
        {
          verse: "“Blessed is the man who remains steadfast under trial, for when he has stood the test he will receive the crown of life.” — James 1:12",
          message: "You're on the right path. Push through the moments that make it easy to skip — that's exactly where faithfulness is built.",
        },
        {
          verse: "“Let us run with endurance the race that is set before us.” — Hebrews 12:1",
          message: "You've got real momentum. Keep tightening up your rhythm and this commitment will become second nature.",
        },
      ],
      tooEarly: [
        {
          verse: "“Let us consider how to stir up one another to love and good works, not neglecting to meet together.” — Hebrews 10:24-25",
          message: "You're just getting started — keep showing up! Every check-in builds the foundation of a faithful habit.",
        },
        {
          verse: "“He who began a good work in you will bring it to completion.” — Philippians 1:6",
          message: "It's early days, and that's okay. Keep at it — what God starts, He's faithful to complete.",
        },
        {
          verse: "“Be steadfast, immovable, always abounding in the work of the Lord.” — 1 Corinthians 15:58",
          message: "A few more check-ins and we'll have a clearer picture of your rhythm. Stay steady — you're building something real.",
        },
      ],
      notStarted: [
        {
          verse: "“Draw near to God, and he will draw near to you.” — James 4:8",
          message: "You haven't checked in for this one yet. Take the first step today — consistency starts with a single faithful decision.",
        },
        {
          verse: "“But seek first the kingdom of God and his righteousness, and all these things will be added to you.” — Matthew 6:33",
          message: "This one's still waiting on you. Make it a priority this week — small beginnings lead to lasting habits.",
        },
        {
          verse: "“Whatever your hand finds to do, do it with your might.” — Ecclesiastes 9:10",
          message: "No check-ins yet for this task. Whenever you're ready, show up fully — that first step matters more than you think.",
        },
      ],
    },
  },
  es: {
    back: "⬅ Atrás",
    title: "Obtener mi Código QR",
    subtitle: "Ingresa el número de teléfono de tu perfil para obtener tu código QR de asistencia.",
    phonePlaceholder: "Número de Teléfono",
    submit: "Obtener mi Código QR",
    submitting: "Buscando...",
    invalidPhone: "Por favor ingresa un número de teléfono válido.",
    notFound: "No se encontró ningún miembro con ese número de teléfono.",
    serverError: "No se pudo conectar con el servidor. Inténtalo de nuevo.",
    idLabel: "ID:",
    saveContact: "👤 Guardar como Contacto (iPhone y Android)",
    savedContactMessage: "Tarjeta de contacto descargada — ábrela y toca \"Agregar a Contactos\" para guardar el código QR como foto de contacto.",
    openScanner: "Abrir Escáner QR (requiere inicio de sesión del personal)",
    commitmentTitle: "Mi Compromiso Fiel",
    commitmentSubtitle: "Cómo te va en cada tarea de registro, con un poco de ánimo.",
    maturityTitle: "La madurez espiritual implica un compromiso fiel",
    maturityIntro: "Hay una diferencia entre estar comprometido y estar fielmente comprometido:",
    maturityPoints: [
      "El compromiso aparece cuando es conveniente. El compromiso fiel aparece con constancia — incluso cuando es difícil (Lucas 16:10).",
      "El compromiso depende de cómo te sientes en el momento. El compromiso fiel está arraigado en el carácter, no en los sentimientos (1 Corintios 4:2).",
      "El compromiso a menudo se desvanece con el tiempo. El compromiso fiel perdura y crece a través de las pruebas, produciendo madurez espiritual (Santiago 1:2-4).",
    ],
    loadingText: "Cargando...",
    noTasks: "Todavía no hay tareas de registro configuradas para esta organización.",
    sessionsCaption: (attended, expected, pct) => `${attended} / ${expected} sesiones esperadas (${pct}%)`,
    checkInsNeededCaption: (attended, min, remaining) =>
      `${attended} de ${min} registros completados — se necesitan ${remaining} más para poder evaluar tu compromiso.`,
    avgGapCaption: (d) => ` · promedio de ${d}d entre registros`,
    levels: {
      Faithful: "Fiel",
      Committed: "Comprometido",
      "Too Early to Evaluate": "Muy Pronto para Evaluar",
      "Not Started": "Sin Comenzar",
    },
    feedback: {
      faithful: [
        {
          verse: "“Bien, buen siervo y fiel; sobre poco has sido fiel, sobre mucho te pondré; entra en el gozo de tu señor.” — Mateo 25:21",
          message: "¡Estás asistiendo con constancia, y se nota! Sigue adelante — tu fidelidad está sembrando semillas que darán fruto a su tiempo.",
        },
        {
          verse: "“He peleado la buena batalla, he acabado la carrera, he guardado la fe.” — 2 Timoteo 4:7",
          message: "Estás corriendo bien esta carrera. Mantén el rumbo — cada registro fiel es parte de una historia que vale la pena terminar bien.",
        },
        {
          verse: "“Sé fiel hasta la muerte, y yo te daré la corona de la vida.” — Apocalipsis 2:10",
          message: "Tu constancia es un testimonio. No te canses — la recompensa de la fidelidad es mucho mayor que el esfuerzo que cuesta.",
        },
      ],
      committed: [
        {
          verse: "“No nos cansemos, pues, de hacer bien; porque a su tiempo segaremos, si no desmayamos.” — Gálatas 6:9",
          message: "Estás participando, pero hay espacio para construir un ritmo más constante. Intenta poner un recordatorio antes de cada sesión — pequeños pasos constantes construyen una fidelidad duradera.",
        },
        {
          verse: "“Bienaventurado el varón que soporta la tentación; porque cuando haya resistido la prueba, recibirá la corona de vida.” — Santiago 1:12",
          message: "Vas por buen camino. Sigue adelante en los momentos en que es fácil faltar — ahí es exactamente donde se construye la fidelidad.",
        },
        {
          verse: "“Corramos con paciencia la carrera que tenemos por delante.” — Hebreos 12:1",
          message: "Ya tienes buen impulso. Sigue ajustando tu ritmo y este compromiso se volverá algo natural.",
        },
      ],
      tooEarly: [
        {
          verse: "“Y considerémonos unos a otros para estimularnos al amor y a las buenas obras; no dejando de congregarnos.” — Hebreos 10:24-25",
          message: "Apenas estás comenzando — ¡sigue viniendo! Cada registro construye la base de un hábito fiel.",
        },
        {
          verse: "“Estando persuadido de esto, que el que comenzó en vosotros la buena obra, la perfeccionará hasta el día de Jesucristo.” — Filipenses 1:6",
          message: "Apenas es el comienzo, y está bien. Sigue así — lo que Dios comienza, Él es fiel para completarlo.",
        },
        {
          verse: "“Estad firmes y constantes, creciendo en la obra del Señor siempre.” — 1 Corintios 15:58",
          message: "Con algunos registros más tendremos un panorama más claro de tu ritmo. Mantente firme — estás construyendo algo real.",
        },
      ],
      notStarted: [
        {
          verse: "“Acercaos a Dios, y él se acercará a vosotros.” — Santiago 4:8",
          message: "Todavía no te has registrado para esto. Da el primer paso hoy — la constancia comienza con una sola decisión fiel.",
        },
        {
          verse: "“Mas buscad primeramente el reino de Dios y su justicia, y todas estas cosas os serán añadidas.” — Mateo 6:33",
          message: "Esta tarea todavía te está esperando. Hazla una prioridad esta semana — los pequeños comienzos llevan a hábitos duraderos.",
        },
        {
          verse: "“Todo lo que te viniere a la mano para hacer, hazlo según tus fuerzas.” — Eclesiastés 9:10",
          message: "Aún no hay registros para esta tarea. Cuando estés listo, preséntate por completo — ese primer paso importa más de lo que crees.",
        },
      ],
    },
  },
};

const LEVEL_TO_MESSAGE_KEY = {
  Faithful: "faithful",
  Committed: "committed",
  "Too Early to Evaluate": "tooEarly",
  "Not Started": "notStarted",
};

// Deterministically picks a variant so the same task always shows the same
// feedback, while different tasks in the same list show different encouragement.
const pickFeedbackVariant = (variants, taskId) => {
  let hash = 0;
  for (let i = 0; i < taskId.length; i++) {
    hash = (hash * 31 + taskId.charCodeAt(i)) >>> 0;
  }
  return variants[hash % variants.length];
};

const PublicQRLookup = () => {
  const { id } = useParams();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const qrCanvasRef = useRef(null);
  const [church, setChurch] = useState(null);
  const [phone, setPhone] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState(null);
  const [showScannerAccess, setShowScannerAccess] = useState(false);
  const [saveMessage, setSaveMessage] = useState("");
  const [commitmentTasks, setCommitmentTasks] = useState(null);
  const [loadingCommitment, setLoadingCommitment] = useState(false);
  const language = searchParams.get("lang") === "es" ? "es" : "en";
  const t = TRANSLATIONS[language];

  const setLanguage = (lang) => {
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      next.set("lang", lang);
      return next;
    });
  };

  useEffect(() => {
    let isMounted = true;
    if (id) {
      getChurchData(id).then((data) => {
        if (isMounted) setChurch(data);
      });
    }
    return () => {
      isMounted = false;
    };
  }, [id]);

  const handleSubmit = async (event) => {
    event.preventDefault();
    setError("");
    setResult(null);

    const digits = phone.replace(/\D/g, "");
    if (digits.length < 7) {
      setError(t.invalidPhone);
      return;
    }

    setLoading(true);
    try {
      const response = await fetch(QR_LOOKUP_FUNCTION_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ churchId: id, phone: digits }),
      });
      const data = await response.json();

      if (!response.ok || !data.success) {
        setError(t.notFound);
        return;
      }

      setResult(data);
      fetchCommitmentSummary(data.uid);
    } catch (fetchError) {
      console.error("QR lookup error:", fetchError);
      setError(t.serverError);
    } finally {
      setLoading(false);
    }
  };

  const fetchCommitmentSummary = async (uid) => {
    setLoadingCommitment(true);
    setCommitmentTasks(null);
    try {
      const response = await fetch(
        `${COMMITMENT_SUMMARY_FUNCTION_URL}?churchId=${encodeURIComponent(id)}&uid=${encodeURIComponent(uid)}`
      );
      const data = await response.json();
      if (response.ok && data.success) {
        setCommitmentTasks(data.tasks.filter((t) => t.configured));
      }
    } catch (commitmentError) {
      console.error("Commitment summary error:", commitmentError);
    } finally {
      setLoadingCommitment(false);
    }
  };

  // Contact photos get aggressively zoom-cropped to a circle/square by different
  // iOS/Android Contacts apps (often beyond just a simple inscribed-circle crop),
  // so keep the QR code small and centered with a very generous white margin
  // to guarantee its corner finder patterns always survive the crop.
  // The QR is drawn at its native size (no rescale) to avoid corrupting modules.
  const getPaddedQrCanvas = () => {
    const sourceCanvas = qrCanvasRef.current;
    if (!sourceCanvas) return null;

    const outputSize = 600;
    const qrDrawSize = sourceCanvas.width; // native size, drawn 1:1 to avoid resampling artifacts
    const offset = (outputSize - qrDrawSize) / 2;

    const paddedCanvas = document.createElement("canvas");
    paddedCanvas.width = outputSize;
    paddedCanvas.height = outputSize;
    const ctx = paddedCanvas.getContext("2d");
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, outputSize, outputSize);
    ctx.drawImage(sourceCanvas, offset, offset);
    return paddedCanvas;
  };

  const handleSaveAsContact = () => {
    setSaveMessage("");
    const paddedCanvas = getPaddedQrCanvas();
    if (!paddedCanvas) return;

    // Embed the padded QR code as the contact's photo so it shows up right in Contacts.
    const base64Photo = paddedCanvas.toDataURL("image/png").split(",")[1];
    const organization = church?.name || "";
    const contactName = `${organization} ${result?.name || ""}`.trim() || "My QR Code";

    const vCardLines = [
      "BEGIN:VCARD",
      "VERSION:3.0",
      `N:;${contactName};;;`,
      `FN:${contactName}`,
      organization ? `ORG:${organization}` : null,
      `NOTE:Check-in QR code ID ${result?.uid || ""}`,
      `PHOTO;ENCODING=b;TYPE=PNG:${base64Photo}`,
      "END:VCARD",
    ].filter(Boolean);

    const blob = new Blob([vCardLines.join("\r\n")], { type: "text/vcard" });
    const objectUrl = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = objectUrl;
    link.download = `${contactName.replace(/[^a-z0-9]+/gi, "-")}.vcf`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(objectUrl);
    setSaveMessage(t.savedContactMessage);
  };

  return (
    <div className="qr-lookup-page">
      <style>{`
        .qr-lookup-page {
          min-height: 100vh;
          background: linear-gradient(180deg, #F8FAFC 0%, #EEF2FF 100%);
          padding: 16px;
          box-sizing: border-box;
        }
        .qr-lookup-back {
          background: none;
          border: none;
          color: #4F46E5;
          font-size: 15px;
          cursor: pointer;
          padding: 8px 4px;
        }
        .qr-lookup-lang-toggle {
          background: white;
          border: 1px solid #4F46E5;
          color: #4F46E5;
          font-size: 13px;
          font-weight: 600;
          cursor: pointer;
          padding: 6px 14px;
          border-radius: 20px;
        }
        .qr-lookup-logo-wrap {
          display: flex;
          justify-content: center;
          margin: 12px 0 20px;
        }
        .qr-lookup-logo-circle {
          width: clamp(144px, 48vw, 208px);
          height: clamp(144px, 48vw, 208px);
          border-radius: 50%;
          background: white;
          box-shadow: 0 2px 8px rgba(0,0,0,0.12);
          display: flex;
          align-items: center;
          justify-content: center;
          padding: 16px;
          box-sizing: border-box;
          overflow: hidden;
        }
        .qr-lookup-logo {
          width: 100%;
          height: 100%;
          object-fit: contain;
        }
        .qr-lookup-card {
          width: 100%;
          max-width: 420px;
          margin: 0 auto;
          padding: clamp(16px, 5vw, 28px);
          background-color: white;
          border-radius: 12px;
          box-shadow: 0 1px 6px rgba(0,0,0,0.1);
          box-sizing: border-box;
        }
        .qr-lookup-title {
          text-align: center;
          margin-bottom: 6px;
          color: #374151;
          font-size: clamp(18px, 5vw, 22px);
        }
        .qr-lookup-org-name {
          text-align: center;
          color: #4F46E5;
          font-weight: 600;
          font-size: clamp(14px, 4vw, 16px);
          margin-bottom: 4px;
        }
        .qr-lookup-subtitle {
          text-align: center;
          color: #6b7280;
          margin-bottom: 20px;
          font-size: 14px;
        }
        .qr-lookup-form {
          display: flex;
          flex-direction: column;
          gap: 12px;
        }
        .qr-lookup-input {
          padding: 12px;
          border-radius: 6px;
          border: 1px solid #d1d5db;
          font-size: 16px;
          width: 100%;
          box-sizing: border-box;
        }
        .qr-lookup-submit {
          padding: 12px;
          border-radius: 6px;
          border: none;
          background-color: #4F46E5;
          color: white;
          font-size: 15px;
          cursor: pointer;
          width: 100%;
        }
        .qr-lookup-submit:disabled {
          opacity: 0.7;
          cursor: not-allowed;
        }
        .qr-lookup-error {
          color: #dc2626;
          margin-top: 16px;
          text-align: center;
          font-size: 14px;
        }
        .qr-lookup-result {
          display: flex;
          flex-direction: column;
          align-items: center;
          margin-top: 24px;
          padding-top: 20px;
          border-top: 1px solid #e5e7eb;
        }
        .qr-lookup-result svg,
        .qr-lookup-result canvas {
          width: clamp(140px, 55vw, 200px) !important;
          height: clamp(140px, 55vw, 200px) !important;
        }
        .qr-lookup-scanner-btn {
          display: block;
          width: 100%;
          margin-top: 24px;
          padding: 12px;
          border-radius: 6px;
          border: 1px solid #4F46E5;
          background-color: white;
          color: #4F46E5;
          font-size: 14px;
          cursor: pointer;
        }
        .qr-lookup-wallet-btn {
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 8px;
          width: 100%;
          margin-top: 16px;
          padding: 12px;
          border-radius: 8px;
          border: none;
          background-color: #4F46E5;
          color: white;
          font-size: 15px;
          font-weight: 500;
          cursor: pointer;
        }
        .qr-lookup-wallet-error {
          color: #dc2626;
          margin-top: 10px;
          text-align: center;
          font-size: 13px;
        }
        .qr-lookup-save-message {
          color: #16a34a;
          margin-top: 10px;
          text-align: center;
          font-size: 13px;
        }
        .qr-commitment-task {
          padding: 20px 0;
          margin-bottom: 8px;
          border-bottom: 2px solid #e5e7eb;
        }
        .qr-commitment-task:last-child {
          border-bottom: none;
          margin-bottom: 0;
          padding-bottom: 0;
        }
        .qr-commitment-image-wrap {
          width: 100%;
          border-radius: 8px;
          overflow: hidden;
          margin-bottom: 10px;
          background: #f3f4f6;
        }
        .qr-commitment-image {
          width: 100%;
          height: 140px;
          object-fit: contain;
          display: block;
          filter: grayscale(var(--qr-grayscale-amount, 0%));
          transition: filter 0.8s ease;
        }
        .qr-commitment-image-hoverable:hover {
          filter: grayscale(0%);
          transition: filter 0.6s ease;
        }
        .qr-commitment-task-header {
          display: flex;
          justify-content: space-between;
          align-items: center;
          gap: 8px;
          flex-wrap: wrap;
          margin-bottom: 6px;
        }
        .qr-commitment-task-title {
          font-weight: 700;
          font-size: 18px;
          color: #1f2937;
        }
        .qr-commitment-task-description {
          margin: 0 0 8px;
          font-size: 13px;
          color: #6b7280;
        }
        .qr-commitment-badge {
          display: inline-block;
          padding: 2px 10px;
          border-radius: 12px;
          font-size: 11px;
          font-weight: 700;
          white-space: nowrap;
        }
        .qr-commitment-badge-faithful { background: #dcfce7; color: #16a34a; }
        .qr-commitment-badge-committed { background: #fef3c7; color: #b45309; }
        .qr-commitment-badge-too-early-to-evaluate,
        .qr-commitment-badge-not-started { background: #f3f4f6; color: #6b7280; }
        .qr-commitment-meter-track {
          width: 100%;
          height: 8px;
          border-radius: 4px;
          background: #f3f4f6;
          overflow: hidden;
        }
        .qr-commitment-meter-fill {
          height: 100%;
          border-radius: 4px;
          transition: width 0.3s ease;
        }
        .qr-commitment-meter-faithful { background: #16a34a; }
        .qr-commitment-meter-committed { background: #f59e0b; }
        .qr-commitment-meter-too-early-to-evaluate,
        .qr-commitment-meter-not-started { background: #9ca3af; }
        .qr-commitment-meter-caption {
          margin: 6px 0 0;
          font-size: 12px;
          color: #6b7280;
        }
        .qr-commitment-feedback {
          margin: 8px 0 2px;
          font-size: 13px;
          color: #374151;
        }
        .qr-commitment-verse {
          margin: 0;
          font-size: 12px;
          font-style: italic;
          color: #4F46E5;
        }
        .qr-maturity-box {
          background: #eef2ff;
          border: 1px solid #e0e7ff;
          border-radius: 8px;
          padding: 14px 16px;
          margin-bottom: 20px;
        }
        .qr-maturity-title {
          margin: 0 0 6px;
          font-size: 14px;
          font-weight: 700;
          color: #4338ca;
        }
        .qr-maturity-intro {
          margin: 0 0 8px;
          font-size: 13px;
          color: #374151;
        }
        .qr-maturity-list {
          margin: 0;
          padding-left: 18px;
          font-size: 13px;
          color: #374151;
          line-height: 1.5;
        }
        .qr-maturity-list li {
          margin-bottom: 6px;
        }
        .qr-maturity-list li:last-child {
          margin-bottom: 0;
        }
      `}</style>

      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <button className="qr-lookup-back" onClick={() => navigate(`/organization/${id}/login`)}>
          {t.back}
        </button>
        <button
          type="button"
          className="qr-lookup-lang-toggle"
          onClick={() => setLanguage(language === "en" ? "es" : "en")}
        >
          {language === "en" ? "Español" : "English"}
        </button>
      </div>

      {church?.logo && (
        <div className="qr-lookup-logo-wrap">
          {/* Triple-click the logo to reveal the staff scanner shortcut */}
          <div
            className="qr-lookup-logo-circle"
            onClick={(event) => {
              if (event.detail === 3) setShowScannerAccess(true);
            }}
          >
            <img src={church.logo} alt={`${church.name || "Organization"} logo`} className="qr-lookup-logo" />
          </div>
        </div>
      )}

      <div className="qr-lookup-card">
        <h2 className="qr-lookup-title">{t.title}</h2>
        {church?.name && <p className="qr-lookup-org-name">{church.name}</p>}
        <p className="qr-lookup-subtitle">{t.subtitle}</p>

        <form onSubmit={handleSubmit} className="qr-lookup-form">
          <input
            type="tel"
            placeholder={t.phonePlaceholder}
            value={phone}
            onChange={(event) => setPhone(event.target.value)}
            required
            className="qr-lookup-input"
          />
          <button type="submit" disabled={loading} className="qr-lookup-submit">
            {loading ? t.submitting : t.submit}
          </button>
        </form>

        {error && <p className="qr-lookup-error">{error}</p>}

        {result && (
          <div className="qr-lookup-result">
            <QRCodeCanvas ref={qrCanvasRef} value={result.uid} size={260} level="H" includeMargin />
            {result.name && (
              <p style={{ marginTop: "12px", fontSize: "15px", color: "#374151" }}>{result.name}</p>
            )}
            <p style={{ fontSize: "12px", color: "#9ca3af" }}>{t.idLabel} {result.uid}</p>
            <button type="button" onClick={handleSaveAsContact} className="qr-lookup-wallet-btn">
              {t.saveContact}
            </button>
            {saveMessage && <p className="qr-lookup-save-message">{saveMessage}</p>}
          </div>
        )}

        {showScannerAccess && (
          <button
            type="button"
            onClick={() => navigate(`/organization/${id}/track-me`)}
            className="qr-lookup-scanner-btn"
          >
            {t.openScanner}
          </button>
        )}
      </div>

      {result && (
        <div className="qr-lookup-card" style={{ marginTop: "16px" }}>
          <h2 className="qr-lookup-title" style={{ marginBottom: "4px" }}>{t.commitmentTitle}</h2>
          <p className="qr-lookup-subtitle">{t.commitmentSubtitle}</p>

          <div className="qr-maturity-box">
            <p className="qr-maturity-title">{t.maturityTitle}</p>
            <p className="qr-maturity-intro">{t.maturityIntro}</p>
            <ol className="qr-maturity-list">
              {t.maturityPoints.map((point, index) => (
                <li key={index}>{point}</li>
              ))}
            </ol>
          </div>

          {loadingCommitment && <p style={{ textAlign: "center", color: "#6b7280", fontSize: "14px" }}>{t.loadingText}</p>}

          {!loadingCommitment && commitmentTasks && commitmentTasks.length === 0 && (
            <p style={{ textAlign: "center", color: "#9ca3af", fontSize: "14px" }}>
              {t.noTasks}
            </p>
          )}

          {!loadingCommitment && commitmentTasks && commitmentTasks.map((task) => {
            const messageKey = LEVEL_TO_MESSAGE_KEY[task.level] || "notStarted";
            const feedback = pickFeedbackVariant(t.feedback[messageKey], task.taskId);
            const levelLabel = t.levels[task.level] || task.level;
            // Grayscale fades out as the member progresses toward Faithful, and
            // once Faithful is reached the image stays fully in color. "Too Early
            // to Evaluate" and "Not Started" are always shown fully grayscale,
            // regardless of raw attendance rate, since no reliable level has been reached yet.
            const isUnevaluated = task.level === "Too Early to Evaluate" || task.level === "Not Started";
            const colorPercent = task.level === "Faithful" ? 100 : isUnevaluated ? 0 : Math.round(task.attendanceRate * 100);
            const grayscaleAmount = Math.max(0, 100 - colorPercent);
            const isGrayscale = grayscaleAmount > 0;
            return (
              <div key={task.taskId} className="qr-commitment-task">
                {task.imageUrl && (
                  <div className="qr-commitment-image-wrap">
                    <img
                      src={task.imageUrl}
                      alt={task.title}
                      className={`qr-commitment-image${isGrayscale ? " qr-commitment-image-hoverable" : ""}`}
                      style={{ "--qr-grayscale-amount": `${grayscaleAmount}%` }}
                    />
                  </div>
                )}
                <div className="qr-commitment-task-header">
                  <span className="qr-commitment-task-title">{task.title}</span>
                  <span className={`qr-commitment-badge qr-commitment-badge-${task.level.replace(/\s+/g, "-").toLowerCase()}`}>
                    {levelLabel}
                  </span>
                </div>
                {task.description && (
                  <p className="qr-commitment-task-description">{task.description}</p>
                )}
                <div className="qr-commitment-meter-track">
                  <div
                    className={`qr-commitment-meter-fill qr-commitment-meter-${task.level.replace(/\s+/g, "-").toLowerCase()}`}
                    style={{
                      width: `${isUnevaluated
                        ? Math.round(Math.min(1, task.attendedCount / task.minCheckInsForEvaluation) * 100)
                        : Math.round(task.attendanceRate * 100)}%`,
                    }}
                  />
                </div>
                <p className="qr-commitment-meter-caption">
                  {isUnevaluated
                    ? t.checkInsNeededCaption(
                        task.attendedCount,
                        task.minCheckInsForEvaluation,
                        Math.max(0, task.minCheckInsForEvaluation - task.attendedCount)
                      )
                    : t.sessionsCaption(task.attendedCount, task.expectedSessions, Math.round(task.attendanceRate * 100))}
                  {!isUnevaluated && task.avgGapDays !== null && t.avgGapCaption(task.avgGapDays)}
                </p>
                <p className="qr-commitment-feedback">{feedback.message}</p>
                <p className="qr-commitment-verse">{feedback.verse}</p>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};

export default PublicQRLookup;
