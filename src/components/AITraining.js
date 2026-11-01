import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useParams } from "react-router-dom";
import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  getDocs,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
} from "firebase/firestore";
import { getDownloadURL, ref, uploadBytes } from "firebase/storage";
import { toast } from "react-toastify";
import ChurchHeader from "./ChurchHeader";
import { useAuth } from "../contexts/AuthContext";
import { auth, db, storage } from "../firebase";
import "./AITraining.css";

const FIREBASE_FUNCTIONS_BASE_URL =
  typeof window !== "undefined" && window.location.hostname === "localhost"
    ? "/firebase-api"
    : "https://us-central1-igletechv1.cloudfunctions.net";

const emptyCourseForm = {
  title: "",
  description: "",
  audience: "",
  courseLanguage: "Spanish",
  teacherInstructions: "",
  isPublished: false,
};

const COURSE_LANGUAGE_OPTIONS = [
  "Spanish",
  "English",
  "Bilingual Spanish/English",
  "French",
  "Portuguese",
  "Other",
];

const emptyLessonForm = {
  title: "",
  summary: "",
  content: "",
  objectives: "",
  practiceInstructions: "",
};

const normalizeText = (value) => String(value || "").trim();

const splitLines = (value) =>
  String(value || "")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);

const formatDate = (value) => {
  if (!value) return "";
  const date = value?.toDate ? value.toDate() : new Date(value);
  if (Number.isNaN(date.getTime())) return "";

  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(date);
};

const extractJsonObject = (value) => {
  const text = normalizeText(value)
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/```$/i, "")
    .replace(/[“”]/g, '"')
    .replace(/[‘’]/g, "'")
    .replace(/,\s*([}\]])/g, "$1")
    .trim();
  if (!text) return null;

  try {
    return JSON.parse(text);
  } catch (error) {
    const startIndex = text.indexOf("{");
    if (startIndex < 0) return null;

    let depth = 0;
    let inString = false;
    let escaped = false;
    let endIndex = -1;

    for (let index = startIndex; index < text.length; index += 1) {
      const character = text[index];
      if (escaped) {
        escaped = false;
        continue;
      }
      if (character === "\\") {
        escaped = true;
        continue;
      }
      if (character === '"') {
        inString = !inString;
        continue;
      }
      if (inString) continue;
      if (character === "{") depth += 1;
      if (character === "}") depth -= 1;
      if (depth === 0) {
        endIndex = index;
        break;
      }
    }

    if (endIndex < 0) return null;

    try {
      return JSON.parse(text.slice(startIndex, endIndex + 1));
    } catch (parseError) {
      return null;
    }
  }
};

const buildConversationTranscript = (messages = []) =>
  messages
    .slice(-10)
    .map((message) => `${message.role === "user" ? "Student" : "Tutor"}: ${normalizeText(message.content)}`)
    .filter(Boolean)
    .join("\n");

const findPreferredHispanicVoice = (voices = []) => {
  const preferredMatchers = [
    (voice) => String(voice.lang || "").toLowerCase() === "es-us",
    (voice) => String(voice.lang || "").toLowerCase() === "es-mx",
    (voice) => String(voice.name || "").toLowerCase().includes("spanish") && String(voice.lang || "").toLowerCase().startsWith("es"),
    (voice) => String(voice.lang || "").toLowerCase().startsWith("es"),
  ];

  for (const matcher of preferredMatchers) {
    const voice = voices.find(matcher);
    if (voice) return voice;
  }

  return voices[0] || null;
};

const formatVoiceLabel = (voice) => {
  if (!voice) return "Default browser voice";
  return `${voice.name}${voice.lang ? ` (${voice.lang})` : ""}`;
};

const prepareTextForSpeech = (value) =>
  normalizeText(value)
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/\*([^*]+)\*/g, "$1")
    .replace(/^\s*[-*•]\s+/gm, "")
    .replace(/\/([A-Za-zÀ-ÿəɑɪʊɛɔæʃʒθðŋː\.\s-]+)\//g, " sonido $1 ")
    .replace(/\[\s*_{2,}\s*\]/g, " blank ")
    .replace(/\(\s*_{2,}\s*\)/g, " blank ")
    .replace(/_{2,}/g, " blank ")
    .replace(/[*/_#>~]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

const extractNextStep = (message = {}) => {
  const gradeNextPractice = normalizeText(message?.grade?.nextPractice);
  if (gradeNextPractice) return gradeNextPractice;

  const content = normalizeText(message?.content);
  if (!content) return "";

  const nextStepMatch = content.match(/(?:next step|siguiente paso)\s*:\s*([^\n]+)/i);
  if (nextStepMatch?.[1]) return nextStepMatch[1].trim();

  return "";
};

const removeInlineNextStep = (value) =>
  normalizeText(value)
    .split("\n")
    .filter((line) => !/^\s*(next step|siguiente paso)\s*:/i.test(line))
    .join("\n")
    .trim();

const sanitizeStorageSegment = (value) =>
  String(value || "item")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "-")
    .replace(/[^a-z0-9._-]/g, "") || "item";

const buildGeminiTeachingPrompt = ({ course, lesson, studentQuestion, conversationHistory }) => {
  const objectives = Array.isArray(lesson?.objectives) ? lesson.objectives.join("\n- ") : "";

  return [
    "You are a warm, conversational AI tutor teaching inside a church training course.",
    "Use only the course and lesson material below as your source of truth.",
    "Respond in the course response language unless the lesson explicitly asks the student to practice another language. If the course is bilingual, explain in the support language and practice in the target language.",
    "If the student asks beyond the material, say what is not covered and suggest what to ask the teacher.",
    "Interact like a real tutor for this specific course: teach one step at a time, explain why the answer is correct, explain why common wrong answers are wrong, then ask one clear follow-up question and wait for the student before moving ahead.",
    "Do not thank the student for sending text, audio, or video. Avoid phrases like Gracias por tu audio, Gracias por tu video, Thanks for sending, or Thank you. Acknowledge briefly as a tutor with phrases like Bien, Escuche tu intento, or Vamos a corregirlo.",
    "Follow the course title, lesson content, objectives, practice instructions, and teacher parameters above everything else. Do not force English, grammar, pronunciation, or language-practice behavior unless this course or lesson is actually about language learning or spoken practice.",
    "For any subject, explain the key concept, why it matters, why the wrong answer is wrong, and how the student should practice it next. Use examples from the lesson material.",
    "If the lesson is a language, grammar, pronunciation, communication, or speech lesson, then use language-tutor behavior: explain the grammar rule, give the sentence formula, contrast one correct and one common wrong example, and coach pronunciation technically.",
    "For pronunciation only when relevant, teach mouth position and sound mechanics in practical language: lips, tongue, teeth, vowel sound, consonant ending, syllable stress, rhythm, linking, and intonation. Use simple phonetic hints such as /ai/, /iz/, or /neim/ only when helpful.",
    "When introducing a target phrase in a language lesson, break it into small chunks and ask the student to repeat slowly before asking for the full sentence.",
    "If a language phrase needs personal information such as a name, ask for that information first. Do not ask the student to say or complete a sentence with the word blank.",
    "When asking for practice, request the evidence type that fits the lesson. Use written answers for writing/knowledge, audio/video for speaking/pronunciation/performance, and both only when the lesson requires both.",
    "After the student makes a real attempt, give correction naturally in the main response. Do not add a separate Response feedback or Pronunciation notes section unless the teacher explicitly asks for detailed grading. If audio/video is relevant to this lesson, mention the most important correction, why it matters, and the next practice action.",
    "Every reply must end with an exact line that starts with: Next step: The line must tell the student exactly what to do now, such as write the phrase, record audio, send video, repeat a word, or correct one specific mistake.",
    "Avoid fill-in-the-blank wording when speaking to the student. Use natural prompts like What is your name? or Tell me your name first, then build the full sentence with their answer.",
    "Do not say the lesson is complete. Completion is handled only by the separate readiness check.",
    "",
    `Course: ${course?.title || "Untitled course"}`,
    `Audience: ${course?.audience || "General students"}`,
    `Course response language: ${course?.courseLanguage || "Spanish"}`,
    `Teacher parameters: ${course?.teacherInstructions || "Use the lesson content faithfully."}`,
    "",
    `Lesson: ${lesson?.title || "Untitled lesson"}`,
    `Lesson summary: ${lesson?.summary || ""}`,
    objectives ? `Learning objectives:\n- ${objectives}` : "Learning objectives: Not specified",
    `Lesson content:\n${lesson?.content || ""}`,
    `Practice instructions:\n${lesson?.practiceInstructions || ""}`,
    "",
    conversationHistory ? `Recent conversation:\n${conversationHistory}` : "Recent conversation: none yet",
    "",
    `Student question: ${studentQuestion || "Teach this lesson and give me one practice activity."}`,
  ].join("\n");
};

const buildReadinessPrompt = ({ course, lesson, conversationHistory }) => {
  const objectives = Array.isArray(lesson?.objectives) ? lesson.objectives.join("\n- ") : "";

  return [
    "You are evaluating whether a student is ready to complete a lesson.",
    "Use only the course content, objectives, practice instructions, and conversation transcript.",
    "Mark ready only when the student has shown understanding of the lesson objectives, not just because they asked to finish.",
    "Return JSON only with this exact shape:",
    '{"readyToComplete":false,"reply":"short message to the student","reason":"short teacher-facing reason","nextStep":"one next step if not ready"}',
    "",
    `Course: ${course?.title || "Untitled course"}`,
    `Teacher parameters: ${course?.teacherInstructions || "Use the lesson content faithfully."}`,
    `Lesson: ${lesson?.title || "Untitled lesson"}`,
    objectives ? `Learning objectives:\n- ${objectives}` : "Learning objectives: Not specified",
    `Lesson content:\n${lesson?.content || ""}`,
    `Practice instructions:\n${lesson?.practiceInstructions || ""}`,
    "",
    `Conversation transcript:\n${conversationHistory || "No conversation yet."}`,
  ].join("\n");
};

const buildAssessmentPrompt = ({ course, lesson, responseMode, writtenResponse, spokenTranscript, speechConfidence, conversationHistory }) => {
  const objectives = Array.isArray(lesson?.objectives) ? lesson.objectives.join("\n- ") : "";

  return [
    "You are grading a student's lesson response as a careful language and lesson tutor.",
    "Grade only from the provided lesson, objectives, practice instructions, written response, spoken transcript, and speech recognition confidence.",
    "For audio/video, the spoken transcript represents what the student said. Use speech confidence as a rough clarity signal, but do not claim you inspected facial expression or raw audio quality.",
    "For pronunciation, be technical and specific. Identify exact words/sounds that need correction: vowel sound, consonant ending, syllable stress, rhythm, intonation, linking, missing words, or extra words.",
    "If the lesson has a target phrase, compare the student's spoken response word-by-word against that phrase. The needsToLearn list should include concrete pronunciation fixes, not generic encouragement.",
    "Grade all three areas even if one area was not submitted. If an area is missing, score it low and explain what the student needs to submit next.",
    "Return JSON only with this exact shape:",
    '{"overallScore":0,"voiceAccentWordingScore":0,"writtenScore":0,"spokenScore":0,"gradeFactor":"short summary","strengths":["short strength"],"needsToLearn":["specific learning gap"],"nextPractice":"specific next practice","readyToComplete":false,"studentFeedback":"short message to the student"}',
    "Scores must be whole numbers from 0 to 100.",
    "",
    `Course: ${course?.title || "Untitled course"}`,
    `Teacher parameters: ${course?.teacherInstructions || "Use the lesson content faithfully."}`,
    `Lesson: ${lesson?.title || "Untitled lesson"}`,
    objectives ? `Learning objectives:\n- ${objectives}` : "Learning objectives: Not specified",
    `Lesson content:\n${lesson?.content || ""}`,
    `Practice instructions:\n${lesson?.practiceInstructions || ""}`,
    "",
    `Response mode: ${responseMode}`,
    `Written response: ${writtenResponse || "Not submitted"}`,
    `Spoken transcript: ${spokenTranscript || "Not submitted"}`,
    `Speech recognition confidence: ${speechConfidence || "Not available"}`,
    conversationHistory ? `Recent tutoring conversation:\n${conversationHistory}` : "Recent tutoring conversation: none",
  ].join("\n");
};

const buildCourseGenerationPrompt = ({ topic, audience, courseLanguage, lessonCount, teacherNotes }) => [
  "You are helping a teacher draft an AI tutoring course.",
  "Create a course that a teacher can review and edit before publishing.",
  "Return only a single valid JSON object. Do not include markdown, code fences, commentary, bullets outside JSON, or trailing commas.",
  "The JSON must be complete and parseable. Keep it concise enough to fit in one response.",
  "Limit the course to no more than 3 lessons for this draft, even if the teacher requested more. The teacher can generate another draft or add lessons manually later.",
  "Keep each lesson content under 450 characters, each summary under 140 characters, and each practiceInstructions under 280 characters.",
  "Return JSON only with this exact shape:",
  '{"title":"course name","description":"short description","audience":"student audience","courseLanguage":"response language","teacherInstructions":"Gemini tutoring rules and grading style","lessons":[{"title":"lesson title","summary":"short summary","content":"teacher-approved lesson content","objectives":["objective"],"practiceInstructions":"what the student should type, say, record, or submit"}]}',
  "Each lesson must be practical, ordered, and ready for a conversational AI tutor.",
  "For language courses, include exact target phrases, pronunciation focus, required written/audio/video practice, and completion criteria.",
  "Avoid blank placeholders. If personal information is needed, instruct Gemini to ask the student first before building the target phrase.",
  "",
  `Topic: ${topic}`,
  `Audience: ${audience || "General students"}`,
  `Course response language: ${courseLanguage || "Spanish"}`,
  `Number of lessons: ${Math.min(Number(lessonCount || 3) || 3, 3)}`,
  `Teacher notes: ${teacherNotes || "None"}`,
].join("\n");

const normalizeGeneratedLesson = (lesson = {}, index = 0) => ({
  title: normalizeText(lesson.title) || `Lesson ${index + 1}`,
  summary: normalizeText(lesson.summary),
  content: normalizeText(lesson.content),
  objectives: Array.isArray(lesson.objectives)
    ? lesson.objectives.map((objective) => normalizeText(objective)).filter(Boolean)
    : splitLines(lesson.objectives),
  practiceInstructions: normalizeText(lesson.practiceInstructions),
});

const AITraining = () => {
  const { id } = useParams();
  const { user } = useAuth();
  const recognitionRef = useRef(null);
  const voiceModeRef = useRef(false);
  const askingTutorRef = useRef(false);
  const assessmentRecognitionRef = useRef(null);
  const chatRecordingRecognitionRef = useRef(null);
  const chatEndRef = useRef(null);
  const chatWindowRef = useRef(null);
  const mediaRecorderRef = useRef(null);
  const chatMediaRecorderRef = useRef(null);
  const mediaStreamRef = useRef(null);
  const chatMediaStreamRef = useRef(null);
  const mediaChunksRef = useRef([]);
  const chatMediaChunksRef = useRef([]);
  const [activeTab, setActiveTab] = useState("student");
  const [courses, setCourses] = useState([]);
  const [lessonsByCourse, setLessonsByCourse] = useState({});
  const [progressByCourse, setProgressByCourse] = useState({});
  const [students, setStudents] = useState([]);
  const [allProgressRecords, setAllProgressRecords] = useState([]);
  const [selectedResetUserId, setSelectedResetUserId] = useState("");
  const [selectedCourseId, setSelectedCourseId] = useState("");
  const [selectedLessonId, setSelectedLessonId] = useState("");
  const [courseForm, setCourseForm] = useState(emptyCourseForm);
  const [lessonForm, setLessonForm] = useState(emptyLessonForm);
  const [generatorForm, setGeneratorForm] = useState({
    topic: "",
    audience: "",
    courseLanguage: "Spanish",
    lessonCount: "4",
    teacherNotes: "",
  });
  const [generatedCourseDraft, setGeneratedCourseDraft] = useState(null);
  const [generatingCourse, setGeneratingCourse] = useState(false);
  const [savingGeneratedCourse, setSavingGeneratedCourse] = useState(false);
  const [editingCourseId, setEditingCourseId] = useState("");
  const [editingLessonId, setEditingLessonId] = useState("");
  const [studentQuestion, setStudentQuestion] = useState("");
  const [chatMessages, setChatMessages] = useState([]);
  const [chatRecordingMode, setChatRecordingMode] = useState("");
  const [chatRecordedMedia, setChatRecordedMedia] = useState(null);
  const [chatMediaPreviewUrl, setChatMediaPreviewUrl] = useState("");
  const [chatSpeechConfidence, setChatSpeechConfidence] = useState("");
  const [isRecordingChatResponse, setIsRecordingChatResponse] = useState(false);
  const [assessmentMode, setAssessmentMode] = useState("text");
  const [writtenResponse, setWrittenResponse] = useState("");
  const [spokenTranscript, setSpokenTranscript] = useState("");
  const [speechConfidence, setSpeechConfidence] = useState("");
  const [mediaPreviewUrl, setMediaPreviewUrl] = useState("");
  const [recordedMedia, setRecordedMedia] = useState(null);
  const [isRecordingResponse, setIsRecordingResponse] = useState(false);
  const [gradeResult, setGradeResult] = useState(null);
  const [speakingMessageId, setSpeakingMessageId] = useState("");
  const [availableVoices, setAvailableVoices] = useState([]);
  const [selectedVoiceURI, setSelectedVoiceURI] = useState("");
  const [isListening, setIsListening] = useState(false);
  const [voiceMode, setVoiceMode] = useState(false);
  const [evaluatingReadiness, setEvaluatingReadiness] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [askingTutor, setAskingTutor] = useState(false);
  const [chatLoading, setChatLoading] = useState(false);
  const [gradingResponse, setGradingResponse] = useState(false);
  const [resettingProgress, setResettingProgress] = useState(false);

  const role = String(user?.role || user?.customRole || user?.assignedRoleId || "").toLowerCase();
  const canManageTraining = role === "admin" || role === "global_admin" || role === "system_admin";

  const coursesPath = useMemo(() => (id ? `churches/${id}/aiTrainingCourses` : ""), [id]);
  const progressPath = useMemo(() => (id ? `churches/${id}/aiTrainingProgress` : ""), [id]);

  const publishedCourses = useMemo(
    () => courses.filter((course) => course.isPublished || canManageTraining),
    [canManageTraining, courses]
  );

  const selectedCourse = publishedCourses.find((course) => course.id === selectedCourseId) || publishedCourses[0] || null;
  const lessons = selectedCourse ? lessonsByCourse[selectedCourse.id] || [] : [];
  const selectedLesson = lessons.find((lesson) => lesson.id === selectedLessonId) || lessons[0] || null;
  const selectedLessonIndex = selectedLesson ? lessons.findIndex((lesson) => lesson.id === selectedLesson.id) : -1;
  const nextLesson = selectedLessonIndex >= 0 ? lessons[selectedLessonIndex + 1] || null : null;

  const selectedProgress = selectedCourse ? progressByCourse[selectedCourse.id] || {} : {};
  const completedLessons = Array.isArray(selectedProgress.completedLessonIds) ? selectedProgress.completedLessonIds : [];
  const aiApprovedLessons = Array.isArray(selectedProgress.aiApprovedLessonIds) ? selectedProgress.aiApprovedLessonIds : [];
  const isSelectedLessonComplete = selectedLesson ? completedLessons.includes(selectedLesson.id) : false;
  const isSelectedLessonApproved = selectedLesson ? aiApprovedLessons.includes(selectedLesson.id) : false;
  const progressId = user?.uid && selectedCourse ? `${user.uid}_${selectedCourse.id}` : "";
  const chatMessagesPath = useMemo(
    () => (id && progressId ? `churches/${id}/aiTrainingProgress/${progressId}/messages` : ""),
    [id, progressId]
  );
  const selectedVoice = useMemo(
    () => availableVoices.find((voice) => voice.voiceURI === selectedVoiceURI) || findPreferredHispanicVoice(availableVoices),
    [availableVoices, selectedVoiceURI]
  );

  useEffect(() => {
    voiceModeRef.current = voiceMode;
  }, [voiceMode]);

  useEffect(() => {
    askingTutorRef.current = askingTutor;
  }, [askingTutor]);

  const loadTraining = useCallback(async () => {
    if (!id || !user) {
      setLoading(false);
      return;
    }

    try {
      setLoading(true);
      const coursesSnapshot = await getDocs(query(collection(db, coursesPath), orderBy("order", "asc")));
      const nextCourses = coursesSnapshot.docs.map((courseDoc, index) => ({
        id: courseDoc.id,
        order: index + 1,
        ...courseDoc.data(),
      }));

      const lessonEntries = await Promise.all(
        nextCourses.map(async (course) => {
          const lessonsSnapshot = await getDocs(
            query(collection(db, `${coursesPath}/${course.id}/lessons`), orderBy("order", "asc"))
          );

          return [
            course.id,
            lessonsSnapshot.docs.map((lessonDoc, index) => ({
              id: lessonDoc.id,
              order: index + 1,
              ...lessonDoc.data(),
            })),
          ];
        })
      );

      const progressSnapshot = await getDocs(
        query(collection(db, progressPath), where("userId", "==", user.uid))
      );

      const [allProgressSnapshot, usersSnapshot] = canManageTraining
        ? await Promise.all([
            getDocs(collection(db, progressPath)),
            getDocs(query(collection(db, "users"), where("churchId", "==", id))),
          ])
        : [{ docs: [] }, { docs: [] }];

      const nextProgress = {};
      progressSnapshot.docs.forEach((progressDoc) => {
        const progress = { id: progressDoc.id, ...progressDoc.data() };
        if (progress.courseId) {
          nextProgress[progress.courseId] = progress;
        }
      });

      setCourses(nextCourses);
      setLessonsByCourse(Object.fromEntries(lessonEntries));
      setProgressByCourse(nextProgress);
      setAllProgressRecords(allProgressSnapshot.docs.map((progressDoc) => ({ id: progressDoc.id, ...progressDoc.data() })));
      setStudents(usersSnapshot.docs.map((userDoc) => ({ id: userDoc.id, uid: userDoc.id, ...userDoc.data() })));

      if (!selectedCourseId && nextCourses.length) {
        const firstVisibleCourse = nextCourses.find((course) => course.isPublished) || (canManageTraining ? nextCourses[0] : null);
        if (!firstVisibleCourse) {
          return;
        }
        setSelectedCourseId(firstVisibleCourse.id);
      }
    } catch (error) {
      console.error("Failed to load AI training:", error);
      toast.error("Could not load AI training yet.");
    } finally {
      setLoading(false);
    }
  }, [canManageTraining, coursesPath, id, progressPath, selectedCourseId, user]);

  useEffect(() => {
    loadTraining();
  }, [loadTraining]);

  const loadLessonChat = useCallback(async () => {
    if (!chatMessagesPath || !selectedLesson?.id) {
      setChatMessages([]);
      return;
    }

    try {
      setChatLoading(true);
      const messagesSnapshot = await getDocs(query(collection(db, chatMessagesPath), orderBy("createdAt", "asc")));
      setChatMessages(
        messagesSnapshot.docs
          .map((messageDoc) => ({ id: messageDoc.id, ...messageDoc.data() }))
          .filter((message) => message.lessonId === selectedLesson.id)
      );
    } catch (error) {
      console.error("Failed to load lesson chat:", error);
      toast.error("Could not load this lesson chat.");
    } finally {
      setChatLoading(false);
    }
  }, [chatMessagesPath, selectedLesson?.id]);

  useEffect(() => {
    loadLessonChat();
  }, [loadLessonChat]);

  const scrollChatToBottom = useCallback((behavior = "smooth") => {
    const chatWindow = chatWindowRef.current;
    if (!chatWindow) return;

    window.requestAnimationFrame(() => {
      chatWindow.scrollTo({
        top: chatWindow.scrollHeight,
        behavior,
      });
    });
  }, []);

  useEffect(() => {
    scrollChatToBottom(chatLoading ? "auto" : "smooth");
  }, [chatMessages, chatLoading, scrollChatToBottom, selectedLesson?.id]);

  useEffect(() => {
    return () => {
      recognitionRef.current?.abort?.();
      assessmentRecognitionRef.current?.abort?.();
      chatRecordingRecognitionRef.current?.abort?.();
      mediaRecorderRef.current?.stop?.();
      chatMediaRecorderRef.current?.stop?.();
      mediaStreamRef.current?.getTracks?.().forEach((track) => track.stop());
      chatMediaStreamRef.current?.getTracks?.().forEach((track) => track.stop());
      if (typeof window !== "undefined" && window.speechSynthesis) {
        window.speechSynthesis.cancel();
      }
    };
  }, []);

  useEffect(() => {
    if (typeof window === "undefined" || !window.speechSynthesis) return undefined;

    const loadVoices = () => {
      const voices = window.speechSynthesis.getVoices();
      setAvailableVoices(voices);
      setSelectedVoiceURI((currentVoiceURI) => {
        if (currentVoiceURI && voices.some((voice) => voice.voiceURI === currentVoiceURI)) {
          return currentVoiceURI;
        }

        return findPreferredHispanicVoice(voices)?.voiceURI || "";
      });
    };

    loadVoices();
    window.speechSynthesis.onvoiceschanged = loadVoices;

    return () => {
      if (window.speechSynthesis.onvoiceschanged === loadVoices) {
        window.speechSynthesis.onvoiceschanged = null;
      }
    };
  }, []);

  useEffect(() => {
    if (!selectedCourse) {
      setSelectedLessonId("");
      return;
    }

    const currentLessons = lessonsByCourse[selectedCourse.id] || [];
    if (currentLessons.length && !currentLessons.some((lesson) => lesson.id === selectedLessonId)) {
      setSelectedLessonId(currentLessons[0].id);
    }
  }, [lessonsByCourse, selectedCourse, selectedLessonId]);

  const handleCourseFieldChange = (event) => {
    const { name, value, checked, type } = event.target;
    setCourseForm((previous) => ({
      ...previous,
      [name]: type === "checkbox" ? checked : value,
    }));
  };

  const handleLessonFieldChange = (event) => {
    const { name, value } = event.target;
    setLessonForm((previous) => ({
      ...previous,
      [name]: value,
    }));
  };

  const handleGeneratorFieldChange = (event) => {
    const { name, value } = event.target;
    setGeneratorForm((previous) => ({
      ...previous,
      [name]: value,
    }));
  };

  const handleGeneratedCourseFieldChange = (event) => {
    const { name, value } = event.target;
    setGeneratedCourseDraft((previous) => previous ? ({ ...previous, [name]: value }) : previous);
  };

  const handleGeneratedLessonFieldChange = (lessonIndex, fieldName, value) => {
    setGeneratedCourseDraft((previous) => {
      if (!previous) return previous;
      const nextLessons = [...(previous.lessons || [])];
      nextLessons[lessonIndex] = {
        ...nextLessons[lessonIndex],
        [fieldName]: fieldName === "objectives" ? splitLines(value) : value,
      };
      return { ...previous, lessons: nextLessons };
    });
  };

  const handleRemoveGeneratedLesson = (lessonIndex) => {
    setGeneratedCourseDraft((previous) => {
      if (!previous) return previous;
      return {
        ...previous,
        lessons: (previous.lessons || []).filter((_, index) => index !== lessonIndex),
      };
    });
  };

  const handleGenerateCourseDraft = async (event) => {
    event.preventDefault();

    if (!canManageTraining) return;

    const topic = normalizeText(generatorForm.topic);
    if (!topic) {
      toast.error("Add a course topic first.");
      return;
    }

    try {
      setGeneratingCourse(true);
      const response = await fetch(`${FIREBASE_FUNCTIONS_BASE_URL}/generateAITrainingCourseDraft`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: "gemini-flash-latest",
          prompt: buildCourseGenerationPrompt(generatorForm),
        }),
      });

      if (!response.ok) {
        throw new Error("Could not generate course draft.");
      }

      const payload = await response.json();
      const parsed = extractJsonObject(payload.text);
      if (!parsed) {
        console.warn("Unparseable Gemini course draft:", payload.text);
        throw new Error("Gemini returned a course draft that could not be parsed.");
      }

      setGeneratedCourseDraft({
        title: normalizeText(parsed.title) || topic,
        description: normalizeText(parsed.description),
        audience: normalizeText(parsed.audience || generatorForm.audience),
        courseLanguage: normalizeText(parsed.courseLanguage || generatorForm.courseLanguage || "Spanish"),
        teacherInstructions: normalizeText(parsed.teacherInstructions),
        isPublished: false,
        lessons: Array.isArray(parsed.lessons) ? parsed.lessons.map(normalizeGeneratedLesson) : [],
      });
      toast.success("Course draft generated. Review and edit it before saving.");
    } catch (error) {
      console.error("Failed to generate course draft:", error);
      toast.error(error.message || "Could not generate course draft.");
    } finally {
      setGeneratingCourse(false);
    }
  };

  const handleSaveGeneratedCourse = async () => {
    if (!canManageTraining || !generatedCourseDraft) return;

    const title = normalizeText(generatedCourseDraft.title);
    if (!title) {
      toast.error("Generated course needs a title.");
      return;
    }

    try {
      setSavingGeneratedCourse(true);
      const createdCourse = await addDoc(collection(db, coursesPath), {
        title,
        description: normalizeText(generatedCourseDraft.description),
        audience: normalizeText(generatedCourseDraft.audience),
        courseLanguage: normalizeText(generatedCourseDraft.courseLanguage) || "Spanish",
        teacherInstructions: normalizeText(generatedCourseDraft.teacherInstructions),
        isPublished: Boolean(generatedCourseDraft.isPublished),
        order: courses.length + 1,
        createdAt: serverTimestamp(),
        createdBy: user?.uid || "",
        updatedAt: serverTimestamp(),
        updatedBy: user?.uid || "",
      });

      await Promise.all((generatedCourseDraft.lessons || []).map((lesson, index) => addDoc(collection(db, `${coursesPath}/${createdCourse.id}/lessons`), {
        title: normalizeText(lesson.title) || `Lesson ${index + 1}`,
        summary: normalizeText(lesson.summary),
        content: normalizeText(lesson.content),
        objectives: Array.isArray(lesson.objectives) ? lesson.objectives.map((objective) => normalizeText(objective)).filter(Boolean) : [],
        practiceInstructions: normalizeText(lesson.practiceInstructions),
        order: index + 1,
        createdAt: serverTimestamp(),
        createdBy: user?.uid || "",
        updatedAt: serverTimestamp(),
        updatedBy: user?.uid || "",
      })));

      setGeneratedCourseDraft(null);
      setSelectedCourseId(createdCourse.id);
      await loadTraining();
      toast.success("Generated course saved.");
    } catch (error) {
      console.error("Failed to save generated course:", error);
      toast.error("Could not save generated course.");
    } finally {
      setSavingGeneratedCourse(false);
    }
  };

  const resetCourseForm = () => {
    setEditingCourseId("");
    setCourseForm(emptyCourseForm);
  };

  const resetLessonForm = () => {
    setEditingLessonId("");
    setLessonForm(emptyLessonForm);
  };

  const handleEditCourse = (course) => {
    setEditingCourseId(course.id);
    setCourseForm({
      title: course.title || "",
      description: course.description || "",
      audience: course.audience || "",
      courseLanguage: course.courseLanguage || "Spanish",
      teacherInstructions: course.teacherInstructions || "",
      isPublished: Boolean(course.isPublished),
    });
    setSelectedCourseId(course.id);
    setActiveTab("teacher");
  };

  const handleSaveCourse = async (event) => {
    event.preventDefault();

    if (!canManageTraining) {
      toast.error("Only admins can manage training courses.");
      return;
    }

    const title = normalizeText(courseForm.title);
    if (!title) {
      toast.error("Course name is required.");
      return;
    }

    try {
      setSaving(true);
      const payload = {
        title,
        description: normalizeText(courseForm.description),
        audience: normalizeText(courseForm.audience),
        courseLanguage: normalizeText(courseForm.courseLanguage) || "Spanish",
        teacherInstructions: normalizeText(courseForm.teacherInstructions),
        isPublished: Boolean(courseForm.isPublished),
        updatedAt: serverTimestamp(),
        updatedBy: user?.uid || "",
      };

      if (editingCourseId) {
        await updateDoc(doc(db, coursesPath, editingCourseId), payload);
        toast.success("Course updated.");
      } else {
        const createdCourse = await addDoc(collection(db, coursesPath), {
          ...payload,
          order: courses.length + 1,
          createdAt: serverTimestamp(),
          createdBy: user?.uid || "",
        });
        setSelectedCourseId(createdCourse.id);
        toast.success("Course created.");
      }

      resetCourseForm();
      await loadTraining();
    } catch (error) {
      console.error("Failed to save course:", error);
      toast.error("Could not save this course.");
    } finally {
      setSaving(false);
    }
  };

  const handleDeleteCourse = async (courseId) => {
    if (!canManageTraining || !window.confirm("Delete this course and its lessons?")) {
      return;
    }

    try {
      const lessonSnapshot = await getDocs(collection(db, `${coursesPath}/${courseId}/lessons`));
      await Promise.all(lessonSnapshot.docs.map((lessonDoc) => deleteDoc(lessonDoc.ref)));
      await deleteDoc(doc(db, coursesPath, courseId));
      if (selectedCourseId === courseId) {
        setSelectedCourseId("");
      }
      toast.success("Course deleted.");
      await loadTraining();
    } catch (error) {
      console.error("Failed to delete course:", error);
      toast.error("Could not delete this course.");
    }
  };

  const handleEditLesson = (lesson) => {
    setEditingLessonId(lesson.id);
    setLessonForm({
      title: lesson.title || "",
      summary: lesson.summary || "",
      content: lesson.content || "",
      objectives: Array.isArray(lesson.objectives) ? lesson.objectives.join("\n") : "",
      practiceInstructions: lesson.practiceInstructions || "",
    });
  };

  const handleSaveLesson = async (event) => {
    event.preventDefault();

    if (!canManageTraining || !selectedCourse) {
      return;
    }

    const title = normalizeText(lessonForm.title);
    if (!title) {
      toast.error("Lesson title is required.");
      return;
    }

    try {
      setSaving(true);
      const lessonsPath = `${coursesPath}/${selectedCourse.id}/lessons`;
      const payload = {
        title,
        summary: normalizeText(lessonForm.summary),
        content: normalizeText(lessonForm.content),
        objectives: splitLines(lessonForm.objectives),
        practiceInstructions: normalizeText(lessonForm.practiceInstructions),
        updatedAt: serverTimestamp(),
        updatedBy: user?.uid || "",
      };

      if (editingLessonId) {
        await updateDoc(doc(db, lessonsPath, editingLessonId), payload);
        toast.success("Lesson updated.");
      } else {
        await addDoc(collection(db, lessonsPath), {
          ...payload,
          order: lessons.length + 1,
          createdAt: serverTimestamp(),
          createdBy: user?.uid || "",
        });
        toast.success("Lesson created.");
      }

      resetLessonForm();
      await loadTraining();
    } catch (error) {
      console.error("Failed to save lesson:", error);
      toast.error("Could not save this lesson.");
    } finally {
      setSaving(false);
    }
  };

  const handleDeleteLesson = async (lessonId) => {
    if (!canManageTraining || !selectedCourse || !window.confirm("Delete this lesson?")) {
      return;
    }

    try {
      await deleteDoc(doc(db, `${coursesPath}/${selectedCourse.id}/lessons`, lessonId));
      toast.success("Lesson deleted.");
      await loadTraining();
    } catch (error) {
      console.error("Failed to delete lesson:", error);
      toast.error("Could not delete this lesson.");
    }
  };

  const handleResetStudentProgress = async () => {
    if (!canManageTraining || !selectedCourse || !selectedResetUserId) {
      toast.error("Select a course and student first.");
      return;
    }

    const student = students.find((item) => (item.uid || item.id) === selectedResetUserId);
    const studentName = student?.displayName || student?.name || student?.email || "this student";
    if (!window.confirm(`Reset ${studentName}'s progress for ${selectedCourse.title}? This clears completion, grades, and lesson chat history.`)) {
      return;
    }

    try {
      setResettingProgress(true);
      const targetProgressId = `${selectedResetUserId}_${selectedCourse.id}`;
      const targetProgressRef = doc(db, progressPath, targetProgressId);
      const messagesSnapshot = await getDocs(collection(db, `${progressPath}/${targetProgressId}/messages`));
      await Promise.all(messagesSnapshot.docs.map((messageDoc) => deleteDoc(messageDoc.ref)));
      await deleteDoc(targetProgressRef);
      setAllProgressRecords((previous) => previous.filter((progress) => progress.id !== targetProgressId));

      if (user?.uid === selectedResetUserId) {
        setProgressByCourse((previous) => {
          const nextProgress = { ...previous };
          delete nextProgress[selectedCourse.id];
          return nextProgress;
        });
        setChatMessages([]);
      }

      toast.success(`${studentName}'s progress was reset.`);
    } catch (error) {
      console.error("Failed to reset student progress:", error);
      toast.error("Could not reset this student's progress.");
    } finally {
      setResettingProgress(false);
    }
  };

  const handleMoveLesson = async (lesson, direction) => {
    if (!selectedCourse) return;

    const currentIndex = lessons.findIndex((item) => item.id === lesson.id);
    const nextIndex = currentIndex + direction;
    if (currentIndex < 0 || nextIndex < 0 || nextIndex >= lessons.length) return;

    const otherLesson = lessons[nextIndex];
    try {
      const lessonsPath = `${coursesPath}/${selectedCourse.id}/lessons`;
      await Promise.all([
        updateDoc(doc(db, lessonsPath, lesson.id), { order: otherLesson.order || nextIndex + 1 }),
        updateDoc(doc(db, lessonsPath, otherLesson.id), { order: lesson.order || currentIndex + 1 }),
      ]);
      await loadTraining();
    } catch (error) {
      console.error("Failed to reorder lessons:", error);
      toast.error("Could not reorder lessons.");
    }
  };

  const handleMarkLessonComplete = async ({ approvalReason = "Gemini approved completion." } = {}) => {
    if (!selectedCourse || !selectedLesson || !user?.uid) return;

    const nextCompletedLessons = Array.from(new Set([...completedLessons, selectedLesson.id]));
    const nextApprovedLessons = Array.from(new Set([...aiApprovedLessons, selectedLesson.id]));
    const progressId = `${user.uid}_${selectedCourse.id}`;
    const payload = {
      userId: user.uid,
      courseId: selectedCourse.id,
      completedLessonIds: nextCompletedLessons,
      aiApprovedLessonIds: nextApprovedLessons,
      lastLessonId: selectedLesson.id,
      completedLessonCount: nextCompletedLessons.length,
      totalLessonCount: lessons.length,
      lastCompletionApproval: {
        lessonId: selectedLesson.id,
        reason: approvalReason,
      },
      updatedAt: serverTimestamp(),
    };

    try {
      await setDoc(doc(db, progressPath, progressId), payload, { merge: true });
      setProgressByCourse((previous) => ({
        ...previous,
        [selectedCourse.id]: {
          ...(previous[selectedCourse.id] || {}),
          ...payload,
          id: progressId,
        },
      }));
      toast.success("Lesson marked complete.");
      if (nextLesson) {
        setSelectedLessonId(nextLesson.id);
        setChatMessages([]);
        stopSpeaking();
      }
    } catch (error) {
      console.error("Failed to save progress:", error);
      toast.error("Could not save your progress.");
    }
  };

  const saveProgressActivity = async ({ lessonId, incrementMessages = false } = {}) => {
    if (!selectedCourse || !user?.uid) return;

    const nextInteractedLessonIds = Array.from(
      new Set([...(Array.isArray(selectedProgress.interactedLessonIds) ? selectedProgress.interactedLessonIds : []), lessonId].filter(Boolean))
    );

    const payload = {
      userId: user.uid,
      courseId: selectedCourse.id,
      lastLessonId: lessonId || selectedLesson?.id || "",
      interactedLessonIds: nextInteractedLessonIds,
      completedLessonIds: completedLessons,
      aiApprovedLessonIds: aiApprovedLessons,
      completedLessonCount: completedLessons.length,
      totalLessonCount: lessons.length,
      chatMessageCount: Number(selectedProgress.chatMessageCount || 0) + (incrementMessages ? 1 : 0),
      updatedAt: serverTimestamp(),
    };

    await setDoc(doc(db, progressPath, `${user.uid}_${selectedCourse.id}`), payload, { merge: true });
    setProgressByCourse((previous) => ({
      ...previous,
      [selectedCourse.id]: {
        ...(previous[selectedCourse.id] || {}),
        ...payload,
        id: `${user.uid}_${selectedCourse.id}`,
      },
    }));
  };

  const stopListening = () => {
    voiceModeRef.current = false;
    recognitionRef.current?.abort?.();
    setIsListening(false);
  };

  const stopCurrentListeningCycle = () => {
    recognitionRef.current?.abort?.();
    setIsListening(false);
  };

  const sendTutorMessage = async (questionOverride = "", messageMeta = {}) => {
    if (!selectedCourse || !selectedLesson) {
      toast.error("Select a course and lesson first.");
      return;
    }

    const question = normalizeText(questionOverride || studentQuestion) || "Teach this lesson and give me one practice activity.";
    const conversationHistory = buildConversationTranscript(chatMessages);
    const mediaInstruction = messageMeta?.mediaUrl
      ? [
          "",
          `The student attached a ${messageMeta.responseMode || "media"} response for this chat turn.`,
          "Use the attached media directly as evidence for what the student said and how clearly they said it.",
          "Do not say you cannot hear or access the audio/video if media is attached. If the media is unclear, say what was unclear and ask the student to retry.",
          messageMeta.speechConfidence ? `Browser transcript confidence: ${messageMeta.speechConfidence}` : "",
        ].filter(Boolean).join("\n")
      : "";
    const prompt = `${buildGeminiTeachingPrompt({
      course: selectedCourse,
      lesson: selectedLesson,
      studentQuestion: question,
      conversationHistory,
    })}${mediaInstruction}`;

    try {
      setAskingTutor(true);
      const localUserMessage = {
        id: `local-user-${Date.now()}`,
        role: "user",
        content: question,
        lessonId: selectedLesson.id,
        ...messageMeta,
      };
      setChatMessages((previous) => [...previous, localUserMessage]);
      setStudentQuestion("");

      if (chatMessagesPath) {
        await setDoc(doc(db, progressPath, `${user.uid}_${selectedCourse.id}`), {
          userId: user.uid,
          courseId: selectedCourse.id,
          completedLessonIds: completedLessons,
          aiApprovedLessonIds: aiApprovedLessons,
          completedLessonCount: completedLessons.length,
          totalLessonCount: lessons.length,
          lastLessonId: selectedLesson.id,
          updatedAt: serverTimestamp(),
        }, { merge: true });

        await addDoc(collection(db, chatMessagesPath), {
          role: "user",
          content: question,
          ...messageMeta,
          courseId: selectedCourse.id,
          lessonId: selectedLesson.id,
          userId: user.uid,
          createdAt: serverTimestamp(),
        });
      }

      const authToken = messageMeta?.mediaUrl ? await auth.currentUser?.getIdToken() : "";
      const response = await fetch(
        messageMeta?.mediaUrl
          ? `${FIREBASE_FUNCTIONS_BASE_URL}/gradeAITrainingAssessment`
          : `${FIREBASE_FUNCTIONS_BASE_URL}/generateTimeRotateInvoiceReview`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(authToken ? { Authorization: `Bearer ${authToken}` } : {}),
        },
        body: JSON.stringify({
          model: messageMeta?.mediaUrl ? "gemini-2.0-flash" : "gemini-flash-latest",
          prompt,
          responseMode: messageMeta?.responseMode || "text",
          mediaUrl: messageMeta?.mediaUrl || "",
          mediaPath: messageMeta?.mediaPath || "",
          mediaMimeType: messageMeta?.mediaMimeType || "",
        }),
      });

      if (!response.ok) {
        let errorMessage = "Gemini tutor request failed.";
        try {
          const errorPayload = await response.json();
          errorMessage = normalizeText(errorPayload?.message || errorPayload?.error || errorPayload?.details?.error?.message) || errorMessage;
        } catch (parseError) {
          errorMessage = `${errorMessage} (${response.status})`;
        }
        throw new Error(errorMessage);
      }

      const payload = await response.json();
      const answer = normalizeText(payload.text) || "Gemini did not return a response.";
      const localAssistantMessage = {
        id: `local-assistant-${Date.now()}`,
        role: "assistant",
        content: answer,
        lessonId: selectedLesson.id,
        messageType: "tutor-feedback",
      };
      setChatMessages((previous) => [...previous, localAssistantMessage]);

      if (chatMessagesPath) {
        await addDoc(collection(db, chatMessagesPath), {
          role: "assistant",
          content: answer,
          messageType: "tutor-feedback",
          courseId: selectedCourse.id,
          lessonId: selectedLesson.id,
          userId: user.uid,
          createdAt: serverTimestamp(),
        });
        await saveProgressActivity({ lessonId: selectedLesson.id, incrementMessages: true });
      }

      speakResponse(answer, localAssistantMessage.id);
    } catch (error) {
      console.error("Gemini tutor failed:", error);
      const fallbackAnswer = "Gemini could not be reached right now. The teacher-defined lesson content is still available above for study and practice.";
      setChatMessages((previous) => [
        ...previous,
        {
          id: `local-error-${Date.now()}`,
          role: "assistant",
          content: fallbackAnswer,
          lessonId: selectedLesson?.id || "",
        },
      ]);
      speakResponse(fallbackAnswer, "fallback");
      toast.error("Could not reach Gemini tutor.");
    } finally {
      setAskingTutor(false);
    }
  };

  const startListening = (options = {}) => {
    if (typeof window === "undefined") return;
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognition) {
      toast.info("Voice listening is not available in this browser. Try Chrome or Edge.");
      return;
    }

    window.speechSynthesis?.cancel?.();
    recognitionRef.current?.abort?.();
    let sentTranscript = false;
    const shouldAutoSend = Boolean(options.autoSend ?? voiceModeRef.current);

    const recognition = new SpeechRecognition();
    recognition.lang = selectedVoice?.lang || "en-US";
    recognition.interimResults = false;
    recognition.continuous = false;
    recognition.onstart = () => setIsListening(true);
    recognition.onend = () => {
      setIsListening(false);
    };
    recognition.onerror = () => {
      setIsListening(false);
    };
    recognition.onresult = (event) => {
      const transcript = Array.from(event.results || [])
        .map((result) => result?.[0]?.transcript || "")
        .join(" ")
        .trim();

      if (!transcript) return;
      sentTranscript = true;
      setStudentQuestion(transcript);
      if (shouldAutoSend) {
        sendTutorMessage(transcript);
      }
    };

    recognitionRef.current = recognition;
    recognition.start();
  };

  const speakResponse = (text, messageId = "latest") => {
    if (typeof window === "undefined" || !window.speechSynthesis || !text) {
      toast.info("Audio playback is not available in this browser.");
      return;
    }

    const speechText = prepareTextForSpeech(text);
    if (!speechText) return;

    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(speechText);
    if (selectedVoice) {
      utterance.voice = selectedVoice;
      utterance.lang = selectedVoice.lang || "es-US";
    } else {
      utterance.lang = "es-US";
    }
    utterance.rate = 0.85;
    utterance.pitch = 1;
    utterance.onend = () => {
      setSpeakingMessageId("");
      if (voiceModeRef.current) {
        window.setTimeout(() => startListening({ autoSend: true }), 450);
      }
    };
    utterance.onerror = () => setSpeakingMessageId("");
    setSpeakingMessageId(messageId);
    window.speechSynthesis.speak(utterance);
  };

  const stopSpeaking = () => {
    if (typeof window !== "undefined" && window.speechSynthesis) {
      window.speechSynthesis.cancel();
    }
    setSpeakingMessageId("");
  };

  const startAssessmentTranscript = () => {
    if (typeof window === "undefined") return;
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognition) {
      toast.info("Speech transcription is not available in this browser. Type the transcript after recording.");
      return;
    }

    assessmentRecognitionRef.current?.abort?.();
    const recognition = new SpeechRecognition();
    recognition.lang = selectedVoice?.lang || "en-US";
    recognition.interimResults = true;
    recognition.continuous = true;
    recognition.onresult = (event) => {
      const transcriptParts = [];
      let confidenceTotal = 0;
      let confidenceCount = 0;

      Array.from(event.results || []).forEach((result) => {
        const alternative = result?.[0];
        if (!alternative?.transcript) return;
        transcriptParts.push(alternative.transcript);
        if (typeof alternative.confidence === "number" && alternative.confidence > 0) {
          confidenceTotal += alternative.confidence;
          confidenceCount += 1;
        }
      });

      setSpokenTranscript(transcriptParts.join(" ").trim());
      if (confidenceCount) {
        setSpeechConfidence(`${Math.round((confidenceTotal / confidenceCount) * 100)}%`);
      }
    };
    recognition.onerror = () => {};
    assessmentRecognitionRef.current = recognition;
    recognition.start();
  };

  const startChatRecordingTranscript = () => {
    if (typeof window === "undefined") return;
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognition) {
      toast.info("Speech transcription is not available in this browser. You can still send the recording and type what you said.");
      return;
    }

    chatRecordingRecognitionRef.current?.abort?.();
    const recognition = new SpeechRecognition();
    recognition.lang = selectedVoice?.lang || "en-US";
    recognition.interimResults = true;
    recognition.continuous = true;
    recognition.onresult = (event) => {
      const transcriptParts = [];
      let confidenceTotal = 0;
      let confidenceCount = 0;

      Array.from(event.results || []).forEach((result) => {
        const alternative = result?.[0];
        if (!alternative?.transcript) return;
        transcriptParts.push(alternative.transcript);
        if (typeof alternative.confidence === "number" && alternative.confidence > 0) {
          confidenceTotal += alternative.confidence;
          confidenceCount += 1;
        }
      });

      setStudentQuestion(transcriptParts.join(" ").trim());
      if (confidenceCount) {
        setChatSpeechConfidence(`${Math.round((confidenceTotal / confidenceCount) * 100)}%`);
      }
    };
    recognition.onerror = () => {};
    chatRecordingRecognitionRef.current = recognition;
    recognition.start();
  };

  const startChatResponseRecording = async (mode) => {
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") {
      toast.error("Recording is not available in this browser.");
      return;
    }

    try {
      stopSpeaking();
      setChatRecordingMode(mode);
      setChatRecordedMedia(null);
      setChatSpeechConfidence("");
      setChatMediaPreviewUrl((previousUrl) => {
        if (previousUrl) URL.revokeObjectURL(previousUrl);
        return "";
      });
      chatMediaChunksRef.current = [];

      const stream = await navigator.mediaDevices.getUserMedia({
        audio: true,
        video: mode === "video",
      });
      chatMediaStreamRef.current = stream;
      const recorder = new MediaRecorder(stream);
      recorder.ondataavailable = (event) => {
        if (event.data?.size) {
          chatMediaChunksRef.current.push(event.data);
        }
      };
      recorder.onstop = () => {
        const mimeType = mode === "video" ? "video/webm" : "audio/webm";
        const blob = new Blob(chatMediaChunksRef.current, { type: mimeType });
        setChatRecordedMedia({ blob, mimeType, mode });
        setChatMediaPreviewUrl(URL.createObjectURL(blob));
        chatMediaStreamRef.current?.getTracks?.().forEach((track) => track.stop());
        chatMediaStreamRef.current = null;
      };
      chatMediaRecorderRef.current = recorder;
      recorder.start();
      startChatRecordingTranscript();
      setIsRecordingChatResponse(true);
    } catch (error) {
      console.error("Failed to start chat recording:", error);
      toast.error("Could not start recording. Check microphone/camera permissions.");
    }
  };

  const stopChatResponseRecording = () => {
    chatRecordingRecognitionRef.current?.stop?.();
    chatMediaRecorderRef.current?.stop?.();
    setIsRecordingChatResponse(false);
  };

  const clearChatRecordedMedia = () => {
    stopChatResponseRecording();
    setChatRecordedMedia(null);
    setChatRecordingMode("");
    setChatSpeechConfidence("");
    setChatMediaPreviewUrl((previousUrl) => {
      if (previousUrl) URL.revokeObjectURL(previousUrl);
      return "";
    });
  };

  const uploadChatRecordedMedia = async () => {
    if (!chatRecordedMedia?.blob) {
      return { mediaUrl: "", mediaPath: "", mediaMimeType: "", responseMode: "text" };
    }

    if (!storage) {
      throw new Error("Firebase Storage is not available for chat media upload.");
    }

    const fileName = `${Date.now()}-${sanitizeStorageSegment(selectedLesson?.title)}-${chatRecordedMedia.mode}.webm`;
    const mediaPath = `churches/${id}/aiTrainingAssessments/${user.uid}/${fileName}`;
    const storageRef = ref(storage, mediaPath);
    await uploadBytes(storageRef, chatRecordedMedia.blob, {
      contentType: chatRecordedMedia.mimeType,
      customMetadata: {
        courseId: selectedCourse?.id || "",
        lessonId: selectedLesson?.id || "",
        responseMode: chatRecordedMedia.mode,
        source: "lesson-chat",
      },
    });

    return {
      mediaUrl: await getDownloadURL(storageRef),
      mediaPath,
      mediaMimeType: chatRecordedMedia.mimeType,
      responseMode: chatRecordedMedia.mode,
    };
  };

  const handleSendChatResponse = async (event) => {
    event.preventDefault();

    if (isRecordingChatResponse) {
      toast.info("Stop recording before sending.");
      return;
    }

    try {
      const uploadedMedia = await uploadChatRecordedMedia();
      const typedOrTranscript = normalizeText(studentQuestion);
      const question = typedOrTranscript || (uploadedMedia.responseMode === "video" ? "I sent a video response." : uploadedMedia.responseMode === "audio" ? "I sent an audio response." : "");

      await sendTutorMessage(question, {
        responseMode: uploadedMedia.responseMode,
        mediaUrl: uploadedMedia.mediaUrl,
        mediaPath: uploadedMedia.mediaPath,
        mediaMimeType: uploadedMedia.mediaMimeType,
        speechConfidence: chatSpeechConfidence,
      });

      clearChatRecordedMedia();
    } catch (error) {
      console.error("Failed to send chat response:", error);
      toast.error("Could not send this audio/video response.");
    }
  };

  const startResponseRecording = async () => {
    if (assessmentMode === "text") return;
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") {
      toast.error("Recording is not available in this browser.");
      return;
    }

    try {
      setGradeResult(null);
      setMediaPreviewUrl((previousUrl) => {
        if (previousUrl) URL.revokeObjectURL(previousUrl);
        return "";
      });
      setRecordedMedia(null);
      mediaChunksRef.current = [];
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: true,
        video: assessmentMode === "video",
      });
      mediaStreamRef.current = stream;
      const recorder = new MediaRecorder(stream);
      recorder.ondataavailable = (event) => {
        if (event.data?.size) {
          mediaChunksRef.current.push(event.data);
        }
      };
      recorder.onstop = () => {
        const mimeType = assessmentMode === "video" ? "video/webm" : "audio/webm";
        const blob = new Blob(mediaChunksRef.current, { type: mimeType });
        setRecordedMedia({ blob, mimeType });
        setMediaPreviewUrl(URL.createObjectURL(blob));
        mediaStreamRef.current?.getTracks?.().forEach((track) => track.stop());
        mediaStreamRef.current = null;
      };
      mediaRecorderRef.current = recorder;
      recorder.start();
      startAssessmentTranscript();
      setIsRecordingResponse(true);
    } catch (error) {
      console.error("Failed to start response recording:", error);
      toast.error("Could not start recording. Check microphone/camera permissions.");
    }
  };

  const stopResponseRecording = () => {
    assessmentRecognitionRef.current?.stop?.();
    mediaRecorderRef.current?.stop?.();
    setIsRecordingResponse(false);
  };

  const resetAssessmentResponse = () => {
    stopResponseRecording();
    setWrittenResponse("");
    setSpokenTranscript("");
    setSpeechConfidence("");
    setGradeResult(null);
    setRecordedMedia(null);
    setMediaPreviewUrl((previousUrl) => {
      if (previousUrl) URL.revokeObjectURL(previousUrl);
      return "";
    });
  };

  const uploadAssessmentMedia = async () => {
    if (!recordedMedia?.blob || assessmentMode === "text") {
      return { mediaUrl: "", mediaPath: "", mediaMimeType: "" };
    }

    if (!storage) {
      throw new Error("Firebase Storage is not available for assessment media upload.");
    }

    const extension = assessmentMode === "video" ? "webm" : "webm";
    const fileName = `${Date.now()}-${sanitizeStorageSegment(selectedLesson?.title)}.${extension}`;
    const mediaPath = `churches/${id}/aiTrainingAssessments/${user.uid}/${fileName}`;
    const storageRef = ref(storage, mediaPath);
    await uploadBytes(storageRef, recordedMedia.blob, {
      contentType: recordedMedia.mimeType,
      customMetadata: {
        courseId: selectedCourse?.id || "",
        lessonId: selectedLesson?.id || "",
        assessmentMode,
      },
    });

    return {
      mediaUrl: await getDownloadURL(storageRef),
      mediaPath,
      mediaMimeType: recordedMedia.mimeType,
    };
  };

  const handleGradeResponse = async () => {
    if (!selectedCourse || !selectedLesson || !user?.uid) return;

    const normalizedWrittenResponse = normalizeText(writtenResponse);
    const normalizedSpokenTranscript = normalizeText(spokenTranscript);
    if (!normalizedWrittenResponse && !normalizedSpokenTranscript) {
      toast.error("Add a written response or record a spoken/video response first.");
      return;
    }

    try {
      setGradingResponse(true);
      const uploadedMedia = await uploadAssessmentMedia();
      const prompt = buildAssessmentPrompt({
        course: selectedCourse,
        lesson: selectedLesson,
        responseMode: assessmentMode,
        writtenResponse: normalizedWrittenResponse,
        spokenTranscript: normalizedSpokenTranscript,
        speechConfidence,
        conversationHistory: buildConversationTranscript(chatMessages),
      });
      const authToken = await auth.currentUser?.getIdToken();
      const response = await fetch(`${FIREBASE_FUNCTIONS_BASE_URL}/gradeAITrainingAssessment`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(authToken ? { Authorization: `Bearer ${authToken}` } : {}),
        },
        body: JSON.stringify({
          model: "gemini-2.0-flash",
          prompt,
          churchId: id,
          courseId: selectedCourse.id,
          lessonId: selectedLesson.id,
          responseMode: assessmentMode,
          mediaUrl: uploadedMedia.mediaUrl,
          mediaPath: uploadedMedia.mediaPath,
          mediaMimeType: uploadedMedia.mediaMimeType,
        }),
      });

      if (!response.ok) {
        throw new Error("Gemini grading request failed.");
      }

      const payload = await response.json();
      const parsed = extractJsonObject(payload.text) || {};
      const nextGradeResult = {
        overallScore: Number(parsed.overallScore || 0),
        voiceAccentWordingScore: Number(parsed.voiceAccentWordingScore || 0),
        writtenScore: Number(parsed.writtenScore || 0),
        spokenScore: Number(parsed.spokenScore || 0),
        gradeFactor: normalizeText(parsed.gradeFactor) || "Gemini graded this response against the lesson requirements.",
        strengths: Array.isArray(parsed.strengths) ? parsed.strengths : [],
        needsToLearn: Array.isArray(parsed.needsToLearn) ? parsed.needsToLearn : [],
        nextPractice: normalizeText(parsed.nextPractice),
        readyToComplete: Boolean(parsed.readyToComplete),
        studentFeedback: normalizeText(parsed.studentFeedback),
      };
      setGradeResult(nextGradeResult);
      const gradeChatContent = [
        nextGradeResult.studentFeedback || `Assessment graded: ${nextGradeResult.overallScore}/100`,
        `Overall: ${nextGradeResult.overallScore}/100`,
        `Voice/accent/wording: ${nextGradeResult.voiceAccentWordingScore}/100`,
        `Written: ${nextGradeResult.writtenScore}/100`,
        `Spoken: ${nextGradeResult.spokenScore}/100`,
        nextGradeResult.nextPractice ? `Next practice: ${nextGradeResult.nextPractice}` : "",
      ].filter(Boolean).join("\n");
      const localGradeMessage = {
        id: `local-grade-${Date.now()}`,
        role: "assistant",
        content: gradeChatContent,
        messageType: "assessment-grade",
        grade: nextGradeResult,
        lessonId: selectedLesson.id,
      };
      setChatMessages((previous) => [...previous, localGradeMessage]);

      if (chatMessagesPath) {
        await addDoc(collection(db, chatMessagesPath), {
          role: "assistant",
          content: gradeChatContent,
          messageType: "assessment-grade",
          assessmentMode,
          writtenResponse: normalizedWrittenResponse,
          spokenTranscript: normalizedSpokenTranscript,
          speechConfidence,
          mediaUrl: uploadedMedia.mediaUrl,
          mediaPath: uploadedMedia.mediaPath,
          mediaMimeType: uploadedMedia.mediaMimeType,
          grade: nextGradeResult,
          courseId: selectedCourse.id,
          lessonId: selectedLesson.id,
          userId: user.uid,
          createdAt: serverTimestamp(),
        });
        await setDoc(doc(db, progressPath, `${user.uid}_${selectedCourse.id}`), {
          userId: user.uid,
          courseId: selectedCourse.id,
          lastLessonId: selectedLesson.id,
          lastAssessment: {
            lessonId: selectedLesson.id,
            assessmentMode,
            overallScore: nextGradeResult.overallScore,
            voiceAccentWordingScore: nextGradeResult.voiceAccentWordingScore,
            writtenScore: nextGradeResult.writtenScore,
            spokenScore: nextGradeResult.spokenScore,
            readyToComplete: nextGradeResult.readyToComplete,
            needsToLearn: nextGradeResult.needsToLearn,
            mediaPath: uploadedMedia.mediaPath,
          },
          updatedAt: serverTimestamp(),
        }, { merge: true });
      }

      if (nextGradeResult.readyToComplete) {
        await handleMarkLessonComplete({ approvalReason: nextGradeResult.gradeFactor });
      }

      speakResponse(nextGradeResult.studentFeedback || nextGradeResult.gradeFactor, `grade-${Date.now()}`);
      toast.success("Response graded.");
    } catch (error) {
      console.error("Failed to grade response:", error);
      toast.error("Could not grade this response.");
    } finally {
      setGradingResponse(false);
    }
  };

  const handleEvaluateLessonReadiness = async () => {
    if (!selectedCourse || !selectedLesson) return;

    const conversationHistory = buildConversationTranscript(chatMessages);
    if (!conversationHistory) {
      toast.info("Have the student interact with Gemini before checking completion.");
      return;
    }

    try {
      setEvaluatingReadiness(true);
      const response = await fetch(`${FIREBASE_FUNCTIONS_BASE_URL}/generateTimeRotateInvoiceReview`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: "gemini-flash-latest",
          prompt: buildReadinessPrompt({ course: selectedCourse, lesson: selectedLesson, conversationHistory }),
        }),
      });

      if (!response.ok) {
        throw new Error("Gemini readiness check failed.");
      }

      const payload = await response.json();
      const parsed = extractJsonObject(payload.text);
      const readyToComplete = Boolean(parsed?.readyToComplete);
      const reply = normalizeText(parsed?.reply) || (readyToComplete
        ? "You are ready to complete this lesson."
        : "You are not quite ready yet. Keep practicing this lesson.");
      const reason = normalizeText(parsed?.reason || parsed?.nextStep || reply);
      const readinessMessage = {
        id: `local-readiness-${Date.now()}`,
        role: "assistant",
        content: reply,
        lessonId: selectedLesson.id,
      };

      setChatMessages((previous) => [...previous, readinessMessage]);

      if (chatMessagesPath) {
        await addDoc(collection(db, chatMessagesPath), {
          role: "assistant",
          content: reply,
          messageType: "readiness-check",
          readyToComplete,
          reason,
          courseId: selectedCourse.id,
          lessonId: selectedLesson.id,
          userId: user.uid,
          createdAt: serverTimestamp(),
        });
      }

      if (readyToComplete) {
        await handleMarkLessonComplete({ approvalReason: reason });
        toast.success("Gemini approved this lesson as complete.");
      } else {
        await saveProgressActivity({ lessonId: selectedLesson.id });
        toast.info("Gemini wants more practice before completion.");
      }

      speakResponse(reply, readinessMessage.id);
    } catch (error) {
      console.error("Gemini readiness check failed:", error);
      toast.error("Could not check lesson readiness.");
    } finally {
      setEvaluatingReadiness(false);
    }
  };

  const handleAskTutor = async (event) => {
    event.preventDefault();
    sendTutorMessage();
  };

  if (loading) {
    return (
      <div className="ai-training-page">
        <ChurchHeader id={id} />
        <div className="ai-training-loading">Loading AI training...</div>
      </div>
    );
  }

  return (
    <div className="ai-training-page">
      <ChurchHeader id={id} />

      <div className="ai-training-shell">
        <div className="ai-training-hero">
          <div>
            <span className="ai-training-kicker">Gemini learning module</span>
            <h1>AI Training</h1>
            <p>Build courses and lessons that become the guardrails Gemini uses to teach students.</p>
          </div>
          <div className="ai-training-stats">
            <span>{courses.length}</span>
            <small>Courses</small>
          </div>
        </div>

        <div className="ai-training-tabs" role="tablist" aria-label="AI training sections">
          <button className={activeTab === "student" ? "active" : ""} onClick={() => setActiveTab("student")} type="button">
            Student
          </button>
          {canManageTraining && (
            <button className={activeTab === "teacher" ? "active" : ""} onClick={() => setActiveTab("teacher")} type="button">
              Teacher
            </button>
          )}
        </div>

        {activeTab === "teacher" && canManageTraining ? (
          <div className="ai-training-grid">
            <section className="ai-training-panel ai-training-wide">
              <div className="ai-training-panel-heading">
                <h2>Generate course with Gemini</h2>
              </div>
              <form onSubmit={handleGenerateCourseDraft} className="ai-training-form ai-training-generator-form">
                <label>
                  What should the class teach?
                  <input name="topic" value={generatorForm.topic} onChange={handleGeneratorFieldChange} placeholder="Beginner English greetings for Spanish speakers" />
                </label>
                <label>
                  Student audience
                  <input name="audience" value={generatorForm.audience} onChange={handleGeneratorFieldChange} placeholder="Spanish-speaking adults learning basic English" />
                </label>
                <label>
                  Course language
                  <select name="courseLanguage" value={generatorForm.courseLanguage} onChange={handleGeneratorFieldChange}>
                    {COURSE_LANGUAGE_OPTIONS.map((language) => <option key={language} value={language}>{language}</option>)}
                  </select>
                </label>
                <label>
                  Number of lessons
                  <input name="lessonCount" type="number" min="1" max="12" value={generatorForm.lessonCount} onChange={handleGeneratorFieldChange} />
                </label>
                <label>
                  Teacher notes
                  <textarea name="teacherNotes" value={generatorForm.teacherNotes} onChange={handleGeneratorFieldChange} rows="4" placeholder="Include audio/video practice, pronunciation grading, and do not advance until the phrase is clear." />
                </label>
                <button className="ai-training-primary" type="submit" disabled={generatingCourse}>
                  {generatingCourse ? "Generating..." : "Generate draft"}
                </button>
              </form>

              {generatedCourseDraft && (
                <div className="ai-training-generated-draft">
                  <div className="ai-training-panel-heading">
                    <h3>Review generated draft</h3>
                    <button type="button" onClick={() => setGeneratedCourseDraft(null)}>Discard</button>
                  </div>
                  <div className="ai-training-form">
                    <label>
                      Course name
                      <input name="title" value={generatedCourseDraft.title} onChange={handleGeneratedCourseFieldChange} />
                    </label>
                    <label>
                      Description
                      <textarea name="description" value={generatedCourseDraft.description} onChange={handleGeneratedCourseFieldChange} rows="3" />
                    </label>
                    <label>
                      Audience
                      <input name="audience" value={generatedCourseDraft.audience} onChange={handleGeneratedCourseFieldChange} />
                    </label>
                    <label>
                      Course language
                      <select name="courseLanguage" value={generatedCourseDraft.courseLanguage || "Spanish"} onChange={handleGeneratedCourseFieldChange}>
                        {COURSE_LANGUAGE_OPTIONS.map((language) => <option key={language} value={language}>{language}</option>)}
                      </select>
                    </label>
                    <label>
                      Gemini teaching parameters
                      <textarea name="teacherInstructions" value={generatedCourseDraft.teacherInstructions} onChange={handleGeneratedCourseFieldChange} rows="5" />
                    </label>
                    <label className="ai-training-checkbox">
                      <input
                        type="checkbox"
                        checked={Boolean(generatedCourseDraft.isPublished)}
                        onChange={(event) => setGeneratedCourseDraft((previous) => previous ? ({ ...previous, isPublished: event.target.checked }) : previous)}
                      />
                      Publish after saving
                    </label>
                  </div>
                  <div className="ai-training-generated-lessons">
                    {(generatedCourseDraft.lessons || []).map((lesson, lessonIndex) => (
                      <article key={`generated-lesson-${lessonIndex}`} className="ai-training-generated-lesson">
                        <div className="ai-training-panel-heading">
                          <h4>Lesson {lessonIndex + 1}</h4>
                          <button type="button" onClick={() => handleRemoveGeneratedLesson(lessonIndex)}>Remove</button>
                        </div>
                        <label>
                          Title
                          <input value={lesson.title} onChange={(event) => handleGeneratedLessonFieldChange(lessonIndex, "title", event.target.value)} />
                        </label>
                        <label>
                          Summary
                          <textarea value={lesson.summary} onChange={(event) => handleGeneratedLessonFieldChange(lessonIndex, "summary", event.target.value)} rows="2" />
                        </label>
                        <label>
                          Content
                          <textarea value={lesson.content} onChange={(event) => handleGeneratedLessonFieldChange(lessonIndex, "content", event.target.value)} rows="6" />
                        </label>
                        <label>
                          Objectives, one per line
                          <textarea value={(lesson.objectives || []).join("\n")} onChange={(event) => handleGeneratedLessonFieldChange(lessonIndex, "objectives", event.target.value)} rows="3" />
                        </label>
                        <label>
                          Practice instructions
                          <textarea value={lesson.practiceInstructions} onChange={(event) => handleGeneratedLessonFieldChange(lessonIndex, "practiceInstructions", event.target.value)} rows="3" />
                        </label>
                      </article>
                    ))}
                  </div>
                  <button className="ai-training-primary" type="button" onClick={handleSaveGeneratedCourse} disabled={savingGeneratedCourse}>
                    {savingGeneratedCourse ? "Saving..." : "Create generated course"}
                  </button>
                </div>
              )}
            </section>

            <section className="ai-training-panel">
              <div className="ai-training-panel-heading">
                <h2>{editingCourseId ? "Edit course" : "Create course"}</h2>
                {editingCourseId && <button type="button" onClick={resetCourseForm}>Cancel</button>}
              </div>
              <form onSubmit={handleSaveCourse} className="ai-training-form">
                <label>
                  Course name
                  <input name="title" value={courseForm.title} onChange={handleCourseFieldChange} placeholder="Foundations of Discipleship" />
                </label>
                <label>
                  Description
                  <textarea name="description" value={courseForm.description} onChange={handleCourseFieldChange} rows="3" />
                </label>
                <label>
                  Student audience
                  <input name="audience" value={courseForm.audience} onChange={handleCourseFieldChange} placeholder="New believers, youth leaders, ministry team..." />
                </label>
                <label>
                  Course language
                  <select name="courseLanguage" value={courseForm.courseLanguage} onChange={handleCourseFieldChange}>
                    {COURSE_LANGUAGE_OPTIONS.map((language) => <option key={language} value={language}>{language}</option>)}
                  </select>
                </label>
                <label>
                  Gemini teaching parameters
                  <textarea
                    name="teacherInstructions"
                    value={courseForm.teacherInstructions}
                    onChange={handleCourseFieldChange}
                    rows="5"
                    placeholder="Tone, boundaries, doctrine notes, how much help to give, and how practice should work."
                  />
                </label>
                <label className="ai-training-checkbox">
                  <input type="checkbox" name="isPublished" checked={courseForm.isPublished} onChange={handleCourseFieldChange} />
                  Publish to students
                </label>
                <button className="ai-training-primary" type="submit" disabled={saving}>
                  {saving ? "Saving..." : editingCourseId ? "Update course" : "Create course"}
                </button>
              </form>
            </section>

            <section className="ai-training-panel">
              <div className="ai-training-panel-heading">
                <h2>Courses</h2>
              </div>
              <div className="ai-training-list">
                {courses.map((course) => (
                  <article key={course.id} className={`ai-training-list-item ${selectedCourse?.id === course.id ? "selected" : ""}`}>
                    <button type="button" onClick={() => setSelectedCourseId(course.id)}>
                      <strong>{course.title}</strong>
                      <span>{course.isPublished ? "Published" : "Draft"} - {(lessonsByCourse[course.id] || []).length} lessons</span>
                    </button>
                    <div className="ai-training-row-actions">
                      <button type="button" onClick={() => handleEditCourse(course)}>Edit</button>
                      <button type="button" onClick={() => handleDeleteCourse(course.id)}>Delete</button>
                    </div>
                  </article>
                ))}
                {!courses.length && <div className="ai-training-empty">Create the first course to begin.</div>}
              </div>
            </section>

            <section className="ai-training-panel ai-training-wide">
              <div className="ai-training-panel-heading">
                <h2>{selectedCourse ? `Lessons for ${selectedCourse.title}` : "Lessons"}</h2>
                {editingLessonId && <button type="button" onClick={resetLessonForm}>Cancel</button>}
              </div>
              {selectedCourse ? (
                <div className="ai-training-lessons-layout">
                  <form onSubmit={handleSaveLesson} className="ai-training-form">
                    <label>
                      Lesson title
                      <input name="title" value={lessonForm.title} onChange={handleLessonFieldChange} />
                    </label>
                    <label>
                      Summary
                      <textarea name="summary" value={lessonForm.summary} onChange={handleLessonFieldChange} rows="2" />
                    </label>
                    <label>
                      Main lesson content
                      <textarea name="content" value={lessonForm.content} onChange={handleLessonFieldChange} rows="8" />
                    </label>
                    <label>
                      Learning objectives, one per line
                      <textarea name="objectives" value={lessonForm.objectives} onChange={handleLessonFieldChange} rows="4" />
                    </label>
                    <label>
                      Practice instructions
                      <textarea name="practiceInstructions" value={lessonForm.practiceInstructions} onChange={handleLessonFieldChange} rows="4" />
                    </label>
                    <button className="ai-training-primary" type="submit" disabled={saving}>
                      {editingLessonId ? "Update lesson" : "Add lesson"}
                    </button>
                  </form>

                  <div className="ai-training-list">
                    {lessons.map((lesson, index) => (
                      <article key={lesson.id} className="ai-training-lesson-item">
                        <div>
                          <strong>{index + 1}. {lesson.title}</strong>
                          <span>{lesson.summary || "No summary yet"}</span>
                        </div>
                        <div className="ai-training-row-actions">
                          <button type="button" onClick={() => handleMoveLesson(lesson, -1)} disabled={index === 0}>Up</button>
                          <button type="button" onClick={() => handleMoveLesson(lesson, 1)} disabled={index === lessons.length - 1}>Down</button>
                          <button type="button" onClick={() => handleEditLesson(lesson)}>Edit</button>
                          <button type="button" onClick={() => handleDeleteLesson(lesson.id)}>Delete</button>
                        </div>
                      </article>
                    ))}
                    {!lessons.length && <div className="ai-training-empty">Add lessons to define what Gemini can teach.</div>}
                  </div>
                </div>
              ) : (
                <div className="ai-training-empty">Select or create a course first.</div>
              )}
            </section>

            <section className="ai-training-panel ai-training-wide">
              <div className="ai-training-panel-heading">
                <h2>Reset student progress</h2>
              </div>
              {selectedCourse ? (
                <div className="ai-training-reset-panel">
                  <label className="ai-training-assessment-field">
                    Student
                    <select value={selectedResetUserId} onChange={(event) => setSelectedResetUserId(event.target.value)}>
                      <option value="">Select student</option>
                      {students.map((student) => {
                        const studentId = student.uid || student.id;
                        const label = student.displayName || student.name || student.email || studentId;
                        return <option key={studentId} value={studentId}>{label}</option>;
                      })}
                    </select>
                  </label>
                  {selectedResetUserId && (
                    <div className="ai-training-reset-summary">
                      {(() => {
                        const progress = allProgressRecords.find((item) => item.userId === selectedResetUserId && item.courseId === selectedCourse.id);
                        const completedCount = Array.isArray(progress?.completedLessonIds) ? progress.completedLessonIds.length : 0;
                        const approvedCount = Array.isArray(progress?.aiApprovedLessonIds) ? progress.aiApprovedLessonIds.length : 0;
                        return (
                          <>
                            <strong>{completedCount}/{lessons.length} lessons complete</strong>
                            <span>{approvedCount} Gemini-approved lessons. Reset clears completion, grades, last activity, and chat history for this course.</span>
                          </>
                        );
                      })()}
                    </div>
                  )}
                  <button className="ai-training-danger" type="button" onClick={handleResetStudentProgress} disabled={!selectedResetUserId || resettingProgress}>
                    {resettingProgress ? "Resetting..." : "Reset selected student to zero"}
                  </button>
                </div>
              ) : (
                <div className="ai-training-empty">Select a course before resetting a student's progress.</div>
              )}
            </section>
          </div>
        ) : (
          <div className="ai-training-student-layout">
            <aside className="ai-training-panel ai-training-course-sidebar">
              <h2>My courses</h2>
              <div className="ai-training-list">
                {publishedCourses.map((course) => {
                  const courseLessons = lessonsByCourse[course.id] || [];
                  const progress = progressByCourse[course.id] || {};
                  const doneCount = Array.isArray(progress.completedLessonIds) ? progress.completedLessonIds.length : 0;
                  return (
                    <button
                      key={course.id}
                      type="button"
                      className={`ai-training-course-choice ${selectedCourse?.id === course.id ? "selected" : ""}`}
                      onClick={() => {
                        setSelectedCourseId(course.id);
                        stopSpeaking();
                      }}
                    >
                      <strong>{course.title}</strong>
                      <span>{doneCount}/{courseLessons.length} lessons complete</span>
                    </button>
                  );
                })}
                {!publishedCourses.length && <div className="ai-training-empty">No published courses are available yet.</div>}
              </div>
            </aside>

            <main className="ai-training-panel ai-training-student-main">
              {selectedCourse && selectedLesson ? (
                <>
                  <div className="ai-training-course-header">
                    <div>
                      <span className="ai-training-kicker">{selectedCourse.audience || "Student training"}</span>
                      <h2>{selectedCourse.title}</h2>
                      <p>{selectedCourse.description}</p>
                      <p className="ai-training-course-language">Language: {selectedCourse.courseLanguage || "Spanish"}</p>
                    </div>
                    <div className="ai-training-progress-pill">
                      {completedLessons.length}/{lessons.length} complete
                    </div>
                  </div>

                  <div className="ai-training-lesson-picker">
                    {lessons.map((lesson, index) => (
                      <button
                        key={lesson.id}
                        type="button"
                        className={selectedLesson.id === lesson.id ? "active" : ""}
                        onClick={() => {
                          setSelectedLessonId(lesson.id);
                          stopSpeaking();
                        }}
                      >
                        <span>{completedLessons.includes(lesson.id) ? "OK" : index + 1}</span>
                        {lesson.title}
                      </button>
                    ))}
                  </div>

                  <article className="ai-training-lesson-content">
                    <span className="ai-training-kicker">Lesson {lessons.findIndex((lesson) => lesson.id === selectedLesson.id) + 1}</span>
                    <h3>{selectedLesson.title}</h3>
                    {selectedLesson.summary && <p className="ai-training-summary">{selectedLesson.summary}</p>}
                    {Array.isArray(selectedLesson.objectives) && selectedLesson.objectives.length > 0 && (
                      <div className="ai-training-objectives">
                        <strong>Objectives</strong>
                        <ul>
                          {selectedLesson.objectives.map((objective) => <li key={objective}>{objective}</li>)}
                        </ul>
                      </div>
                    )}
                    <div className="ai-training-readable-text">{selectedLesson.content}</div>
                    {selectedLesson.practiceInstructions && (
                      <div className="ai-training-practice">
                        <strong>Practice</strong>
                        <p>{selectedLesson.practiceInstructions}</p>
                      </div>
                    )}
                    <div className={`ai-training-completion-card ${isSelectedLessonComplete ? "complete" : ""}`}>
                      <div>
                        <strong>{isSelectedLessonComplete ? "Lesson complete" : "Gemini decides completion"}</strong>
                        <p>
                          {isSelectedLessonComplete && nextLesson
                            ? `You can continue to ${nextLesson.title}.`
                            : isSelectedLessonComplete && !nextLesson
                              ? "Course complete. There are no more lessons in this course."
                              : isSelectedLessonApproved
                            ? "Gemini approved this lesson after reviewing the student conversation."
                            : "When the student has practiced enough, ask Gemini to check readiness. The lesson is completed only if Gemini approves it."}
                        </p>
                      </div>
                      {isSelectedLessonComplete && nextLesson ? (
                        <button
                          className="ai-training-primary"
                          type="button"
                          onClick={() => {
                            setSelectedLessonId(nextLesson.id);
                            setChatMessages([]);
                            stopSpeaking();
                          }}
                        >
                          Go to next lesson
                        </button>
                      ) : (
                        <button
                          className="ai-training-primary"
                          type="button"
                          onClick={handleEvaluateLessonReadiness}
                          disabled={evaluatingReadiness || askingTutor || isSelectedLessonComplete}
                        >
                          {evaluatingReadiness ? "Checking..." : isSelectedLessonComplete ? "Approved" : "Check readiness"}
                        </button>
                      )}
                    </div>

                    <section className="ai-training-assessment-card">
                      <div className="ai-training-assessment-heading">
                        <div>
                          <h3>Student response grade</h3>
                          <p>Submit text, audio, or video. Gemini grades written work, spoken response, and voice/accent/wording.</p>
                        </div>
                        <div className="ai-training-mode-toggle" role="group" aria-label="Response type">
                          {[
                            { value: "text", label: "Text" },
                            { value: "audio", label: "Audio" },
                            { value: "video", label: "Video" },
                          ].map((option) => (
                            <button
                              key={option.value}
                              type="button"
                              className={assessmentMode === option.value ? "active" : ""}
                              onClick={() => {
                                setAssessmentMode(option.value);
                                resetAssessmentResponse();
                              }}
                            >
                              {option.label}
                            </button>
                          ))}
                        </div>
                      </div>

                      <label className="ai-training-assessment-field">
                        Written response
                        <textarea
                          value={writtenResponse}
                          onChange={(event) => setWrittenResponse(event.target.value)}
                          rows="4"
                          placeholder="Student can type the answer here, or use this for corrections after speaking."
                        />
                      </label>

                      {assessmentMode !== "text" && (
                        <div className="ai-training-recording-box">
                          <div className="ai-training-recording-actions">
                            <button type="button" onClick={isRecordingResponse ? stopResponseRecording : startResponseRecording}>
                              {isRecordingResponse ? "Stop recording" : assessmentMode === "video" ? "Record video" : "Record audio"}
                            </button>
                            <span>{isRecordingResponse ? "Recording and transcribing..." : "The transcript below is what Gemini grades for spoken content."}</span>
                          </div>

                          {mediaPreviewUrl && assessmentMode === "audio" && (
                            <audio controls src={mediaPreviewUrl} className="ai-training-media-preview">
                              <track kind="captions" />
                            </audio>
                          )}
                          {mediaPreviewUrl && assessmentMode === "video" && (
                            <video controls src={mediaPreviewUrl} className="ai-training-media-preview">
                              <track kind="captions" />
                            </video>
                          )}

                          <label className="ai-training-assessment-field">
                            Spoken transcript
                            <textarea
                              value={spokenTranscript}
                              onChange={(event) => setSpokenTranscript(event.target.value)}
                              rows="4"
                              placeholder="Transcript appears here. The student or teacher can correct it before grading."
                            />
                          </label>
                          {speechConfidence && <div className="ai-training-confidence">Speech confidence: {speechConfidence}</div>}
                        </div>
                      )}

                      <div className="ai-training-assessment-actions">
                        <button className="ai-training-primary" type="button" onClick={handleGradeResponse} disabled={gradingResponse || isRecordingResponse}>
                          {gradingResponse ? "Grading..." : "Grade response"}
                        </button>
                        <button type="button" onClick={resetAssessmentResponse} disabled={gradingResponse || isRecordingResponse}>
                          Reset response
                        </button>
                      </div>

                      {gradeResult && (
                        <div className="ai-training-grade-card">
                          <div className="ai-training-score-grid">
                            <div><strong>{gradeResult.overallScore}</strong><span>Overall</span></div>
                            <div><strong>{gradeResult.voiceAccentWordingScore}</strong><span>Voice/accent/wording</span></div>
                            <div><strong>{gradeResult.writtenScore}</strong><span>Written</span></div>
                            <div><strong>{gradeResult.spokenScore}</strong><span>Spoken</span></div>
                          </div>
                          <p><strong>Grade factor:</strong> {gradeResult.gradeFactor}</p>
                          {gradeResult.studentFeedback && <p><strong>Feedback:</strong> {gradeResult.studentFeedback}</p>}
                          {gradeResult.needsToLearn.length > 0 && (
                            <div>
                              <strong>What they still need to learn</strong>
                              <ul>
                                {gradeResult.needsToLearn.map((item) => <li key={item}>{item}</li>)}
                              </ul>
                            </div>
                          )}
                          {gradeResult.nextPractice && <p><strong>Next practice:</strong> {gradeResult.nextPractice}</p>}
                        </div>
                      )}
                    </section>
                  </article>

                  <section className="ai-training-tutor">
                    <div>
                      <h3>Interactive lesson chat</h3>
                      <p>Talk or type with Gemini. It should coach one step at a time and decide when the student is ready.</p>
                    </div>
                    <div className="ai-training-voice-controls">
                      <button
                        type="button"
                        className={voiceMode ? "active" : ""}
                        onClick={() => {
                          const nextVoiceMode = !voiceMode;
                          voiceModeRef.current = nextVoiceMode;
                          setVoiceMode(nextVoiceMode);
                          if (nextVoiceMode) {
                            startListening({ autoSend: true });
                          } else {
                            stopListening();
                            stopSpeaking();
                          }
                        }}
                      >
                        {voiceMode ? "Voice mode on" : "Voice mode off"}
                      </button>
                      <button type="button" onClick={isListening ? stopCurrentListeningCycle : () => startListening({ autoSend: true })} disabled={askingTutor || voiceMode}>
                        {isListening ? "Stop listening" : "Listen once"}
                      </button>
                      <label className="ai-training-voice-select">
                        Voice
                        <select
                          value={selectedVoice?.voiceURI || ""}
                          onChange={(event) => setSelectedVoiceURI(event.target.value)}
                          disabled={!availableVoices.length}
                        >
                          {!availableVoices.length && <option value="">Default browser voice</option>}
                          {availableVoices.map((voice) => (
                            <option key={voice.voiceURI} value={voice.voiceURI}>
                              {formatVoiceLabel(voice)}
                            </option>
                          ))}
                        </select>
                      </label>
                      <span>{isListening ? "Listening..." : voiceMode ? "Gemini will listen again after it speaks." : "Use the microphone or type below."}</span>
                    </div>
                    <div className="ai-training-chat-window" aria-live="polite" ref={chatWindowRef}>
                      {chatLoading ? (
                        <div className="ai-training-empty">Loading chat...</div>
                      ) : chatMessages.length ? (
                        chatMessages.map((message) => {
                          return (
                            <article key={message.id} className={`ai-training-chat-message ${message.role === "user" ? "user" : "assistant"}`}>
                              <div>
                                <strong>{message.role === "user" ? "You" : "Gemini"}</strong>
                                <p>{message.content}</p>
                                {message.mediaUrl && message.responseMode === "audio" && (
                                  <audio controls src={message.mediaUrl} className="ai-training-chat-media" onLoadedMetadata={() => scrollChatToBottom("auto")}>
                                    <track kind="captions" />
                                  </audio>
                                )}
                                {message.mediaUrl && message.responseMode === "video" && (
                                  <video controls src={message.mediaUrl} className="ai-training-chat-media" onLoadedMetadata={() => scrollChatToBottom("auto")}>
                                    <track kind="captions" />
                                  </video>
                                )}
                              </div>
                              {message.role === "assistant" && (
                                <button
                                  type="button"
                                  className="ai-training-audio-button"
                                  onClick={() => speakingMessageId === message.id ? stopSpeaking() : speakResponse(message.content, message.id)}
                                >
                                  {speakingMessageId === message.id ? "Stop audio" : "Play audio"}
                                </button>
                              )}
                            </article>
                          );
                        })
                      ) : (
                        <div className="ai-training-empty">Start a lesson conversation with Gemini.</div>
                      )}
                      <div ref={chatEndRef} aria-hidden="true" />
                    </div>
                    <form onSubmit={handleSendChatResponse}>
                      <textarea
                        value={studentQuestion}
                        onChange={(event) => setStudentQuestion(event.target.value)}
                        placeholder="Type your answer, or record audio/video and the transcript will appear here..."
                        rows="4"
                      />
                      <div className="ai-training-chat-recorder">
                        <button type="button" onClick={() => startChatResponseRecording("audio")} disabled={askingTutor || isRecordingChatResponse}>
                          Record audio
                        </button>
                        <button type="button" onClick={() => startChatResponseRecording("video")} disabled={askingTutor || isRecordingChatResponse}>
                          Record video
                        </button>
                        {isRecordingChatResponse && (
                          <button type="button" className="active" onClick={stopChatResponseRecording}>
                            Stop recording
                          </button>
                        )}
                        {chatRecordedMedia && !isRecordingChatResponse && (
                          <button type="button" onClick={clearChatRecordedMedia}>
                            Clear recording
                          </button>
                        )}
                        <span>
                          {isRecordingChatResponse
                            ? "Recording your chat response..."
                            : chatRecordedMedia
                              ? "Recording ready. Send it with your message."
                              : "Students can answer by text, audio, or video."}
                        </span>
                      </div>
                      {chatMediaPreviewUrl && chatRecordedMedia?.mode === "audio" && (
                        <audio controls src={chatMediaPreviewUrl} className="ai-training-chat-media">
                          <track kind="captions" />
                        </audio>
                      )}
                      {chatMediaPreviewUrl && chatRecordedMedia?.mode === "video" && (
                        <video controls src={chatMediaPreviewUrl} className="ai-training-chat-media">
                          <track kind="captions" />
                        </video>
                      )}
                      {chatSpeechConfidence && <div className="ai-training-confidence">Speech confidence: {chatSpeechConfidence}</div>}
                      <button className="ai-training-primary" type="submit" disabled={askingTutor || isRecordingChatResponse}>
                        {askingTutor ? "Sending..." : "Send message"}
                      </button>
                    </form>
                  </section>

                  {selectedProgress.updatedAt && (
                    <div className="ai-training-progress-note">Last activity {formatDate(selectedProgress.updatedAt)}</div>
                  )}
                </>
              ) : (
                <div className="ai-training-empty">Choose a published course with lessons to start learning.</div>
              )}
            </main>
          </div>
        )}
      </div>
    </div>
  );
};

export default AITraining;