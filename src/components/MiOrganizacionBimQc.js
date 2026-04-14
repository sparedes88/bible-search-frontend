import React, { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { useAuth } from "../contexts/AuthContext";
import { db, storage } from "../firebase";
import { addDoc, collection, deleteDoc, doc, getDocs, orderBy, query, updateDoc } from "firebase/firestore";
import { getDownloadURL, ref, uploadBytes } from "firebase/storage";
import { toast } from "react-toastify";
import ChurchHeader from "./ChurchHeader";
import commonStyles from "../pages/commonStyles";

const buildBimQcUniqueId = () => {
  const dateChunk = new Date().toISOString().slice(2, 10).replace(/-/g, "");
  const randomChunk = Math.floor(100 + Math.random() * 900);
  return `BQC-${dateChunk}-${randomChunk}`;
};

const MiOrganizacionBimQc = () => {
  const { id } = useParams();
  const { user } = useAuth();
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [categoryLoading, setCategoryLoading] = useState(false);
  const [categorySaving, setCategorySaving] = useState(false);
  const [lessonsLoading, setLessonsLoading] = useState(false);
  const [lessonsSaving, setLessonsSaving] = useState(false);
  const [items, setItems] = useState([]);
  const [categories, setCategories] = useState([]);
  const [lessons, setLessons] = useState([]);
  const [categoryDraft, setCategoryDraft] = useState("");
  const [editingCategoryId, setEditingCategoryId] = useState("");
  const [editingCategoryName, setEditingCategoryName] = useState("");
  const [selectedCategoryName, setSelectedCategoryName] = useState("");
  const [editingLessonId, setEditingLessonId] = useState("");
  const [lightboxLesson, setLightboxLesson] = useState(null);
  const [isPinEditMode, setIsPinEditMode] = useState(false);
  const [selectedPinId, setSelectedPinId] = useState("");
  const [pendingPin, setPendingPin] = useState(null);
  const [pendingPinSpecId, setPendingPinSpecId] = useState("");
  const [pinSaving, setPinSaving] = useState(false);
  const [form, setForm] = useState({
    specReference: "",
    note: "",
    categoryTags: [],
    imageFile: null,
    imagePreviewUrl: ""
  });
  const [lessonForm, setLessonForm] = useState({
    title: "",
    description: "",
    imageFile: null,
    imagePreviewUrl: "",
    imageUrl: "",
    imagePath: "",
    imageName: ""
  });

  const routePrefix =
    typeof window !== "undefined" && window.location?.pathname?.includes("/church/")
      ? "/church"
      : "/organization";

  useEffect(() => {
    const load = async () => {
      if (!id || !user) {
        setItems([]);
        return;
      }

      try {
        setLoading(true);
        const specsRef = collection(db, "churches", String(id), "bimQcSpecs");
        const specsQuery = query(specsRef, orderBy("createdAt", "desc"));

        let snapshot;
        try {
          snapshot = await getDocs(specsQuery);
        } catch (innerError) {
          if (innerError?.code === "failed-precondition") {
            snapshot = await getDocs(specsRef);
          } else {
            throw innerError;
          }
        }

        const nextItems = snapshot.docs
          .map((itemDoc) => ({ id: itemDoc.id, ...itemDoc.data() }))
          .sort((a, b) => String(b.createdAt || "").localeCompare(String(a.createdAt || "")));
        setItems(nextItems);
      } catch (error) {
        console.error("Error loading BIM QC specs:", error);
        toast.error("Failed to load BIM QC specs");
      } finally {
        setLoading(false);
      }
    };

    load();
  }, [id, user]);

  useEffect(() => {
    const loadCategories = async () => {
      if (!id || !user) {
        setCategories([]);
        return;
      }

      try {
        setCategoryLoading(true);
        const categoriesRef = collection(db, "churches", String(id), "bimQcCategories");
        const categoriesQuery = query(categoriesRef, orderBy("name", "asc"));
        let snapshot;

        try {
          snapshot = await getDocs(categoriesQuery);
        } catch (innerError) {
          if (innerError?.code === "failed-precondition") {
            snapshot = await getDocs(categoriesRef);
          } else {
            throw innerError;
          }
        }

        const list = snapshot.docs
          .map((categoryDoc) => ({ id: categoryDoc.id, ...categoryDoc.data() }))
          .filter((category) => String(category.name || "").trim())
          .sort((a, b) => String(a.name || "").localeCompare(String(b.name || "")));
        setCategories(list);
      } catch (error) {
        console.error("Error loading BIM QC categories:", error);
        toast.error("Failed to load BIM QC categories");
      } finally {
        setCategoryLoading(false);
      }
    };

    loadCategories();
  }, [id, user]);

  useEffect(() => {
    const loadLessons = async () => {
      if (!id || !user) {
        setLessons([]);
        return;
      }

      try {
        setLessonsLoading(true);
        const lessonsRef = collection(db, "churches", String(id), "bimQcLessons");
        const lessonsQuery = query(lessonsRef, orderBy("createdAt", "desc"));
        let snapshot;

        try {
          snapshot = await getDocs(lessonsQuery);
        } catch (innerError) {
          if (innerError?.code === "failed-precondition") {
            snapshot = await getDocs(lessonsRef);
          } else {
            throw innerError;
          }
        }

        const list = snapshot.docs
          .map((lessonDoc) => ({ id: lessonDoc.id, ...lessonDoc.data() }))
          .sort((a, b) => String(b.createdAt || "").localeCompare(String(a.createdAt || "")));
        setLessons(list);
      } catch (error) {
        console.error("Error loading lessons learned:", error);
        toast.error("Failed to load lessons learned");
      } finally {
        setLessonsLoading(false);
      }
    };

    loadLessons();
  }, [id, user]);

  const handleImageChange = (event) => {
    const nextFile = event.target.files?.[0] || null;
    setForm((prev) => ({
      ...prev,
      imageFile: nextFile,
      imagePreviewUrl: nextFile ? URL.createObjectURL(nextFile) : ""
    }));
  };

  const handleSave = async (event) => {
    event.preventDefault();
    if (!id || !user) return;

    const note = String(form.note || "").trim();
    const specReference = String(form.specReference || "").trim();
    const categoryTags = Array.isArray(form.categoryTags) ? form.categoryTags : [];

    if (!form.imageFile) {
      toast.error("Please upload an image for BIM QC.");
      return;
    }
    if (!note) {
      toast.error("Please add a note.");
      return;
    }
    if (!specReference) {
      toast.error("Please enter the related spec reference.");
      return;
    }
    if (categoryTags.length === 0) {
      toast.error("Please add at least one category tag.");
      return;
    }

    try {
      setSaving(true);
      const uniqueId = buildBimQcUniqueId();
      const imageName = form.imageFile.name || "bim-qc-image";
      const imagePath = `churches/${id}/bim-qc/${uniqueId}-${Date.now()}-${imageName}`;
      const imageRef = ref(storage, imagePath);

      await uploadBytes(imageRef, form.imageFile);
      const imageUrl = await getDownloadURL(imageRef);

      const payload = {
        uniqueId,
        specReference,
        note,
        categoryTags,
        imageUrl,
        imagePath,
        imageName,
        churchId: String(id),
        createdAt: new Date().toISOString(),
        createdBy: {
          uid: user.uid || "unknown",
          displayName: user.displayName || user.email || "Unknown"
        }
      };

      const docRef = await addDoc(collection(db, "churches", String(id), "bimQcSpecs"), payload);
      setItems((prev) => [{ id: docRef.id, ...payload }, ...prev]);
      setForm({
        specReference: "",
        note: "",
        categoryTags: [],
        imageFile: null,
        imagePreviewUrl: ""
      });
      setSelectedCategoryName("");
      toast.success("BIM QC spec saved");
    } catch (error) {
      console.error("Error saving BIM QC spec:", error);
      toast.error(`Failed to save BIM QC spec: ${error?.code || error?.message || "Unknown error"}`);
    } finally {
      setSaving(false);
    }
  };

  const handleCreateCategory = async () => {
    if (!id || !user) return;
    const nextName = String(categoryDraft || "").trim();
    if (!nextName) return;

    const exists = categories.some(
      (category) => String(category.name || "").trim().toLowerCase() === nextName.toLowerCase()
    );
    if (exists) {
      toast.error("That category already exists.");
      return;
    }

    try {
      setCategorySaving(true);
      const payload = {
        name: nextName,
        createdAt: new Date().toISOString(),
        createdBy: user.uid || "unknown"
      };
      const createdRef = await addDoc(collection(db, "churches", String(id), "bimQcCategories"), payload);
      setCategories((prev) => [...prev, { id: createdRef.id, ...payload }].sort((a, b) => String(a.name || "").localeCompare(String(b.name || ""))));
      setCategoryDraft("");
      toast.success("Category created");
    } catch (error) {
      console.error("Error creating BIM QC category:", error);
      toast.error(`Failed to create category: ${error?.code || error?.message || "Unknown error"}`);
    } finally {
      setCategorySaving(false);
    }
  };

  const startEditCategory = (category) => {
    setEditingCategoryId(category.id);
    setEditingCategoryName(String(category.name || ""));
  };

  const cancelEditCategory = () => {
    setEditingCategoryId("");
    setEditingCategoryName("");
  };

  const handleUpdateCategory = async (categoryId) => {
    if (!id || !categoryId) return;
    const nextName = String(editingCategoryName || "").trim();
    if (!nextName) {
      toast.error("Category name cannot be empty.");
      return;
    }

    const duplicate = categories.some(
      (category) =>
        category.id !== categoryId &&
        String(category.name || "").trim().toLowerCase() === nextName.toLowerCase()
    );
    if (duplicate) {
      toast.error("Another category already uses that name.");
      return;
    }

    try {
      setCategorySaving(true);
      await updateDoc(doc(db, "churches", String(id), "bimQcCategories", categoryId), {
        name: nextName,
        updatedAt: new Date().toISOString()
      });

      const renamedFrom = categories.find((category) => category.id === categoryId)?.name || "";
      setCategories((prev) =>
        prev
          .map((category) => (category.id === categoryId ? { ...category, name: nextName, updatedAt: new Date().toISOString() } : category))
          .sort((a, b) => String(a.name || "").localeCompare(String(b.name || "")))
      );
      setForm((prev) => ({
        ...prev,
        categoryTags: (prev.categoryTags || []).map((tag) => (tag === renamedFrom ? nextName : tag))
      }));
      if (selectedCategoryName === renamedFrom) {
        setSelectedCategoryName(nextName);
      }
      cancelEditCategory();
      toast.success("Category updated");
    } catch (error) {
      console.error("Error updating BIM QC category:", error);
      toast.error(`Failed to update category: ${error?.code || error?.message || "Unknown error"}`);
    } finally {
      setCategorySaving(false);
    }
  };

  const handleDeleteCategory = async (category) => {
    if (!id || !category?.id) return;
    if (!window.confirm(`Delete category "${category.name}"?`)) return;

    try {
      setCategorySaving(true);
      await deleteDoc(doc(db, "churches", String(id), "bimQcCategories", category.id));
      setCategories((prev) => prev.filter((item) => item.id !== category.id));
      setForm((prev) => ({
        ...prev,
        categoryTags: (prev.categoryTags || []).filter((tag) => tag !== category.name)
      }));
      if (selectedCategoryName === category.name) {
        setSelectedCategoryName("");
      }
      if (editingCategoryId === category.id) {
        cancelEditCategory();
      }
      toast.success("Category deleted");
    } catch (error) {
      console.error("Error deleting BIM QC category:", error);
      toast.error(`Failed to delete category: ${error?.code || error?.message || "Unknown error"}`);
    } finally {
      setCategorySaving(false);
    }
  };

  const handleAddSelectedCategory = () => {
    const selected = String(selectedCategoryName || "").trim();
    if (!selected) return;
    setForm((prev) => {
      const nextTags = Array.from(new Set([...(prev.categoryTags || []), selected]));
      return { ...prev, categoryTags: nextTags };
    });
  };

  const handleRemoveSelectedCategory = (tagName) => {
    setForm((prev) => ({
      ...prev,
      categoryTags: (prev.categoryTags || []).filter((tag) => tag !== tagName)
    }));
  };

  const handleLessonImageChange = (event) => {
    const nextFile = event.target.files?.[0] || null;
    setLessonForm((prev) => ({
      ...prev,
      imageFile: nextFile,
      imagePreviewUrl: nextFile ? URL.createObjectURL(nextFile) : prev.imagePreviewUrl
    }));
  };

  const resetLessonForm = () => {
    setEditingLessonId("");
    setLessonForm({
      title: "",
      description: "",
      imageFile: null,
      imagePreviewUrl: "",
      imageUrl: "",
      imagePath: "",
      imageName: ""
    });
  };

  const handleSaveLesson = async (event) => {
    event.preventDefault();
    if (!id || !user) return;

    const title = String(lessonForm.title || "").trim();
    const description = String(lessonForm.description || "").trim();

    if (!title) {
      toast.error("Lesson title is required.");
      return;
    }
    if (!description) {
      toast.error("Lesson description is required.");
      return;
    }
    if (!editingLessonId && !lessonForm.imageFile) {
      toast.error("Please upload an image for the lesson.");
      return;
    }

    try {
      setLessonsSaving(true);

      let imageUrl = lessonForm.imageUrl || "";
      let imagePath = lessonForm.imagePath || "";
      let imageName = lessonForm.imageName || "";

      if (lessonForm.imageFile) {
        const fileName = lessonForm.imageFile.name || "lesson-image";
        const storagePath = `churches/${id}/bim-qc-lessons/${Date.now()}-${fileName}`;
        const imageRef = ref(storage, storagePath);
        await uploadBytes(imageRef, lessonForm.imageFile);
        imageUrl = await getDownloadURL(imageRef);
        imagePath = storagePath;
        imageName = fileName;
      }

      if (!imageUrl) {
        toast.error("Lesson image is required.");
        return;
      }

      if (!editingLessonId) {
        const payload = {
          title,
          description,
          imageUrl,
          imagePath,
          imageName,
          pins: [],
          churchId: String(id),
          createdAt: new Date().toISOString(),
          createdBy: {
            uid: user.uid || "unknown",
            displayName: user.displayName || user.email || "Unknown"
          }
        };
        const createdRef = await addDoc(collection(db, "churches", String(id), "bimQcLessons"), payload);
        setLessons((prev) => [{ id: createdRef.id, ...payload }, ...prev]);
        toast.success("Lesson created");
      } else {
        const updatePayload = {
          title,
          description,
          imageUrl,
          imagePath,
          imageName,
          updatedAt: new Date().toISOString()
        };
        await updateDoc(doc(db, "churches", String(id), "bimQcLessons", editingLessonId), updatePayload);
        setLessons((prev) => prev.map((lesson) => (lesson.id === editingLessonId ? { ...lesson, ...updatePayload } : lesson)));
        if (lightboxLesson?.id === editingLessonId) {
          setLightboxLesson((prev) => ({ ...prev, ...updatePayload }));
        }
        toast.success("Lesson updated");
      }

      resetLessonForm();
    } catch (error) {
      console.error("Error saving lesson:", error);
      toast.error(`Failed to save lesson: ${error?.code || error?.message || "Unknown error"}`);
    } finally {
      setLessonsSaving(false);
    }
  };

  const handleEditLesson = (lesson) => {
    setEditingLessonId(lesson.id);
    setLessonForm({
      title: lesson.title || "",
      description: lesson.description || "",
      imageFile: null,
      imagePreviewUrl: lesson.imageUrl || "",
      imageUrl: lesson.imageUrl || "",
      imagePath: lesson.imagePath || "",
      imageName: lesson.imageName || ""
    });
  };

  const handleDeleteLesson = async (lesson) => {
    if (!id || !lesson?.id) return;
    if (!window.confirm(`Delete lesson "${lesson.title || "Untitled"}"?`)) return;

    try {
      await deleteDoc(doc(db, "churches", String(id), "bimQcLessons", lesson.id));
      setLessons((prev) => prev.filter((item) => item.id !== lesson.id));
      if (lightboxLesson?.id === lesson.id) {
        setLightboxLesson(null);
      }
      if (editingLessonId === lesson.id) {
        resetLessonForm();
      }
      toast.success("Lesson deleted");
    } catch (error) {
      console.error("Error deleting lesson:", error);
      toast.error(`Failed to delete lesson: ${error?.code || error?.message || "Unknown error"}`);
    }
  };

  const openLightbox = (lesson) => {
    setLightboxLesson(lesson);
    setIsPinEditMode(false);
    setSelectedPinId("");
    setPendingPin(null);
    setPendingPinSpecId("");
  };

  const closeLightbox = () => {
    setLightboxLesson(null);
    setIsPinEditMode(false);
    setSelectedPinId("");
    setPendingPin(null);
    setPendingPinSpecId("");
  };

  const setLightboxMode = (nextMode) => {
    const nextIsEdit = nextMode === "edit";
    setIsPinEditMode(nextIsEdit);
    if (!nextIsEdit) {
      setPendingPin(null);
      setPendingPinSpecId("");
    }
  };

  const handleSelectPin = (pinId) => {
    setSelectedPinId(pinId);
  };

  const handleImageClickForPin = (event) => {
    if (!lightboxLesson || !isPinEditMode) return;
    const img = event.currentTarget;
    const rect = img.getBoundingClientRect();
    const xPct = ((event.clientX - rect.left) / rect.width) * 100;
    const yPct = ((event.clientY - rect.top) / rect.height) * 100;
    setPendingPin({ x: Number(xPct.toFixed(2)), y: Number(yPct.toFixed(2)) });
  };

  const handleSavePin = async () => {
    if (!id || !lightboxLesson?.id) return;
    if (!pendingPin) {
      toast.error("Click the image to place a pin.");
      return;
    }
    if (!pendingPinSpecId) {
      toast.error("Select a spec to associate to the pin.");
      return;
    }

    const selectedSpec = items.find((item) => item.id === pendingPinSpecId);
    if (!selectedSpec) {
      toast.error("Selected spec not found.");
      return;
    }

    const newPin = {
      id: `pin-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
      x: pendingPin.x,
      y: pendingPin.y,
      specDocId: selectedSpec.id,
      specUniqueId: selectedSpec.uniqueId || "",
      specReference: selectedSpec.specReference || "",
      specNote: selectedSpec.note || "",
      specCategoryTags: Array.isArray(selectedSpec.categoryTags) ? selectedSpec.categoryTags : [],
      createdAt: new Date().toISOString(),
      createdBy: user?.uid || "unknown"
    };

    try {
      setPinSaving(true);
      const nextPins = [...(Array.isArray(lightboxLesson.pins) ? lightboxLesson.pins : []), newPin];
      await updateDoc(doc(db, "churches", String(id), "bimQcLessons", lightboxLesson.id), {
        pins: nextPins,
        updatedAt: new Date().toISOString()
      });

      setLessons((prev) => prev.map((lesson) => (lesson.id === lightboxLesson.id ? { ...lesson, pins: nextPins } : lesson)));
      setLightboxLesson((prev) => ({ ...prev, pins: nextPins }));
      setSelectedPinId(newPin.id);
      setPendingPin(null);
      setPendingPinSpecId("");
      toast.success("Pin saved");
    } catch (error) {
      console.error("Error saving pin:", error);
      toast.error(`Failed to save pin: ${error?.code || error?.message || "Unknown error"}`);
    } finally {
      setPinSaving(false);
    }
  };

  const handleDeletePin = async (pinId) => {
    if (!id || !lightboxLesson?.id || !pinId) return;
    try {
      const nextPins = (Array.isArray(lightboxLesson.pins) ? lightboxLesson.pins : []).filter((pin) => pin.id !== pinId);
      await updateDoc(doc(db, "churches", String(id), "bimQcLessons", lightboxLesson.id), {
        pins: nextPins,
        updatedAt: new Date().toISOString()
      });
      setLessons((prev) => prev.map((lesson) => (lesson.id === lightboxLesson.id ? { ...lesson, pins: nextPins } : lesson)));
      setLightboxLesson((prev) => ({ ...prev, pins: nextPins }));
      if (selectedPinId === pinId) {
        setSelectedPinId("");
      }
      toast.success("Pin removed");
    } catch (error) {
      console.error("Error deleting pin:", error);
      toast.error(`Failed to delete pin: ${error?.code || error?.message || "Unknown error"}`);
    }
  };

  const selectedPin = (Array.isArray(lightboxLesson?.pins) ? lightboxLesson.pins : []).find((pin) => pin.id === selectedPinId) || null;
  const selectedPinSpec = selectedPin
    ? items.find((spec) => spec.id === selectedPin.specDocId)
    : null;
  const selectedPinUniqueId = selectedPinSpec?.uniqueId || selectedPin?.specUniqueId || "No ID";
  const selectedPinReference = selectedPinSpec?.specReference || selectedPin?.specReference || "No spec reference";
  const selectedPinNote = selectedPinSpec?.note || selectedPin?.specNote || "No note";
  const selectedPinCategories = Array.isArray(selectedPinSpec?.categoryTags)
    ? selectedPinSpec.categoryTags
    : (Array.isArray(selectedPin?.specCategoryTags) ? selectedPin.specCategoryTags : []);

  return (
    <div style={{ ...commonStyles.fullWidthContainer, position: "relative" }}>
      <Link to={`${routePrefix}/${id}/mi-organizacion`} style={commonStyles.backButtonLink}>
        {"<- Back to Mi Organizacion"}
      </Link>

      <ChurchHeader id={id} applyShadow={false} allowEditBannerLogo={true} />

      <div style={{ marginTop: "1.5rem" }}>
        <h1 style={{ marginBottom: "0.5rem", fontSize: "1.8rem", fontWeight: 700 }}>BIM QC</h1>
        <p style={{ marginTop: 0, color: "#6B7280" }}>
          Upload an image, add a QC note, map the related spec, and tag it with categories. Each record gets a unique ID.
        </p>

        <div
          style={{
            border: "1px solid #E5E7EB",
            borderRadius: "12px",
            backgroundColor: "#FFFFFF",
            padding: "1rem"
          }}
        >
          <form onSubmit={handleSave} style={{ display: "grid", gap: "0.75rem" }}>
            <div>
              <label style={{ fontSize: "14px", fontWeight: 600, color: "#374151" }}>Spec Reference</label>
              <input
                type="text"
                value={form.specReference}
                onChange={(event) => setForm((prev) => ({ ...prev, specReference: event.target.value }))}
                placeholder="Example: CSI 07 21 00 - Thermal Insulation"
                style={{ width: "100%", padding: "10px", borderRadius: "8px", border: "1px solid #E5E7EB", fontSize: "14px", marginTop: "6px" }}
              />
            </div>

            <div>
              <label style={{ fontSize: "14px", fontWeight: 600, color: "#374151" }}>Category Tags</label>
              <div style={{ display: "flex", gap: "8px", flexWrap: "wrap", marginTop: "6px" }}>
                <select
                  value={selectedCategoryName}
                  onChange={(event) => setSelectedCategoryName(event.target.value)}
                  style={{
                    flex: "1 1 240px",
                    padding: "10px",
                    borderRadius: "8px",
                    border: "1px solid #E5E7EB",
                    fontSize: "14px"
                  }}
                >
                  <option value="">Select category</option>
                  {categories.map((category) => (
                    <option key={category.id} value={category.name}>
                      {category.name}
                    </option>
                  ))}
                </select>
                <button
                  type="button"
                  onClick={handleAddSelectedCategory}
                  disabled={!selectedCategoryName}
                  style={{
                    padding: "10px 12px",
                    borderRadius: "8px",
                    border: "1px solid #1D4ED8",
                    backgroundColor: "#2563EB",
                    color: "white",
                    fontWeight: "600",
                    cursor: selectedCategoryName ? "pointer" : "not-allowed"
                  }}
                >
                  Add Tag
                </button>
              </div>
              <div style={{ marginTop: "8px", display: "flex", flexWrap: "wrap", gap: "6px" }}>
                {(form.categoryTags || []).length === 0 && (
                  <span style={{ color: "#6B7280", fontSize: "12px" }}>No category tags selected.</span>
                )}
                {(form.categoryTags || []).map((tag) => (
                  <span
                    key={`selected-${tag}`}
                    style={{
                      display: "inline-flex",
                      alignItems: "center",
                      gap: "6px",
                      fontSize: "12px",
                      padding: "4px 8px",
                      borderRadius: "999px",
                      backgroundColor: "#EEF2FF",
                      color: "#3730A3",
                      border: "1px solid #C7D2FE"
                    }}
                  >
                    {tag}
                    <button
                      type="button"
                      onClick={() => handleRemoveSelectedCategory(tag)}
                      style={{
                        border: "none",
                        background: "transparent",
                        color: "#4338CA",
                        cursor: "pointer",
                        padding: 0,
                        fontSize: "12px",
                        fontWeight: "700"
                      }}
                    >
                      x
                    </button>
                  </span>
                ))}
              </div>
              <div style={{ marginTop: "6px", color: "#6B7280", fontSize: "12px" }}>
                Use the dropdown to add tags from managed categories.
              </div>
            </div>

            <div>
              <label style={{ fontSize: "14px", fontWeight: 600, color: "#374151" }}>QC Note</label>
              <textarea
                value={form.note}
                onChange={(event) => setForm((prev) => ({ ...prev, note: event.target.value }))}
                placeholder="Describe the condition, required spec, and what needs correction."
                rows={4}
                style={{ width: "100%", padding: "10px", borderRadius: "8px", border: "1px solid #E5E7EB", fontSize: "14px", resize: "vertical", marginTop: "6px" }}
              />
            </div>

            <div>
              <label style={{ fontSize: "14px", fontWeight: 600, color: "#374151" }}>Image</label>
              <input type="file" accept="image/*" onChange={handleImageChange} style={{ width: "100%", marginTop: "6px" }} />
              {form.imagePreviewUrl && (
                <img
                  src={form.imagePreviewUrl}
                  alt="BIM QC preview"
                  style={{ marginTop: "10px", maxWidth: "220px", borderRadius: "8px", border: "1px solid #E5E7EB" }}
                />
              )}
            </div>

            <div>
              <button
                type="submit"
                disabled={saving}
                style={{
                  padding: "10px 14px",
                  backgroundColor: "#2563EB",
                  color: "white",
                  border: "none",
                  borderRadius: "8px",
                  fontWeight: "600",
                  cursor: saving ? "not-allowed" : "pointer"
                }}
              >
                {saving ? "Saving..." : "Save BIM QC Spec"}
              </button>
            </div>
          </form>
        </div>

        <div
          style={{
            border: "1px solid #E5E7EB",
            borderRadius: "12px",
            backgroundColor: "#FFFFFF",
            padding: "1rem",
            marginTop: "1rem"
          }}
        >
          <h2 style={{ marginTop: 0, marginBottom: "0.5rem", fontSize: "1.2rem", fontWeight: 700 }}>Manage Tag Categories</h2>
          <p style={{ marginTop: 0, color: "#6B7280", fontSize: "14px" }}>
            Create, edit, or delete category options used in the BIM QC tag dropdown.
          </p>

          <div style={{ display: "flex", gap: "8px", flexWrap: "wrap", marginBottom: "0.75rem" }}>
            <input
              type="text"
              value={categoryDraft}
              onChange={(event) => setCategoryDraft(event.target.value)}
              placeholder="New category name"
              style={{
                flex: "1 1 260px",
                padding: "10px",
                borderRadius: "8px",
                border: "1px solid #E5E7EB",
                fontSize: "14px"
              }}
            />
            <button
              type="button"
              onClick={handleCreateCategory}
              disabled={!String(categoryDraft || "").trim() || categorySaving}
              style={{
                padding: "10px 12px",
                borderRadius: "8px",
                border: "1px solid #059669",
                backgroundColor: "#10B981",
                color: "white",
                fontWeight: "600",
                cursor: String(categoryDraft || "").trim() && !categorySaving ? "pointer" : "not-allowed"
              }}
            >
              Add Category
            </button>
          </div>

          {categoryLoading ? (
            <div style={{ color: "#6B7280" }}>Loading categories...</div>
          ) : categories.length === 0 ? (
            <div style={{ color: "#6B7280" }}>No categories created yet.</div>
          ) : (
            <div style={{ display: "grid", gap: "8px" }}>
              {categories.map((category) => (
                <div
                  key={category.id}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    gap: "10px",
                    padding: "8px 10px",
                    border: "1px solid #E5E7EB",
                    borderRadius: "8px"
                  }}
                >
                  {editingCategoryId === category.id ? (
                    <input
                      type="text"
                      value={editingCategoryName}
                      onChange={(event) => setEditingCategoryName(event.target.value)}
                      style={{
                        flex: 1,
                        padding: "8px",
                        borderRadius: "6px",
                        border: "1px solid #CBD5E1",
                        fontSize: "14px"
                      }}
                    />
                  ) : (
                    <div style={{ fontWeight: 600, color: "#111827" }}>{category.name}</div>
                  )}

                  <div style={{ display: "flex", gap: "6px", flexWrap: "wrap" }}>
                    {editingCategoryId === category.id ? (
                      <>
                        <button
                          type="button"
                          onClick={() => handleUpdateCategory(category.id)}
                          disabled={categorySaving}
                          style={{
                            padding: "6px 10px",
                            borderRadius: "6px",
                            border: "1px solid #2563EB",
                            backgroundColor: "#2563EB",
                            color: "white",
                            cursor: "pointer"
                          }}
                        >
                          Save
                        </button>
                        <button
                          type="button"
                          onClick={cancelEditCategory}
                          style={{
                            padding: "6px 10px",
                            borderRadius: "6px",
                            border: "1px solid #9CA3AF",
                            backgroundColor: "white",
                            color: "#374151",
                            cursor: "pointer"
                          }}
                        >
                          Cancel
                        </button>
                      </>
                    ) : (
                      <>
                        <button
                          type="button"
                          onClick={() => startEditCategory(category)}
                          style={{
                            padding: "6px 10px",
                            borderRadius: "6px",
                            border: "1px solid #2563EB",
                            backgroundColor: "white",
                            color: "#2563EB",
                            cursor: "pointer"
                          }}
                        >
                          Edit
                        </button>
                        <button
                          type="button"
                          onClick={() => handleDeleteCategory(category)}
                          style={{
                            padding: "6px 10px",
                            borderRadius: "6px",
                            border: "1px solid #DC2626",
                            backgroundColor: "white",
                            color: "#DC2626",
                            cursor: "pointer"
                          }}
                        >
                          Delete
                        </button>
                      </>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        <div style={{ marginTop: "1.25rem" }}>
          <h2 style={{ marginBottom: "0.75rem", fontSize: "1.3rem", fontWeight: 700 }}>Saved BIM QC Specs</h2>
          {loading ? (
            <div style={{ color: "#6B7280" }}>Loading BIM QC specs...</div>
          ) : items.length === 0 ? (
            <div style={{ color: "#6B7280" }}>No BIM QC specs saved yet.</div>
          ) : (
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))", gap: "12px" }}>
              {items.map((item) => (
                <div
                  key={item.id}
                  style={{
                    border: "1px solid #E5E7EB",
                    borderRadius: "10px",
                    overflow: "hidden",
                    backgroundColor: "#FFFFFF"
                  }}
                >
                  {item.imageUrl && (
                    <a href={item.imageUrl} target="_blank" rel="noreferrer" style={{ display: "block" }}>
                      <img src={item.imageUrl} alt={item.imageName || item.uniqueId || "BIM QC"} style={{ width: "100%", height: "170px", objectFit: "cover" }} />
                    </a>
                  )}
                  <div style={{ padding: "0.75rem" }}>
                    <div style={{ fontSize: "12px", color: "#6B7280", marginBottom: "4px" }}>Unique ID</div>
                    <div style={{ fontWeight: 700, color: "#111827", marginBottom: "8px" }}>{item.uniqueId || "-"}</div>

                    <div style={{ fontSize: "12px", color: "#6B7280", marginBottom: "4px" }}>Spec</div>
                    <div style={{ color: "#111827", marginBottom: "8px" }}>{item.specReference || "-"}</div>

                    <div style={{ fontSize: "12px", color: "#6B7280", marginBottom: "4px" }}>Note</div>
                    <div style={{ color: "#111827", whiteSpace: "pre-wrap", marginBottom: "10px" }}>{item.note || "-"}</div>

                    <div style={{ display: "flex", flexWrap: "wrap", gap: "6px" }}>
                      {(Array.isArray(item.categoryTags) ? item.categoryTags : []).map((tag) => (
                        <span
                          key={`${item.id}-${tag}`}
                          style={{
                            fontSize: "12px",
                            padding: "4px 8px",
                            borderRadius: "999px",
                            backgroundColor: "#EEF2FF",
                            color: "#3730A3",
                            border: "1px solid #C7D2FE"
                          }}
                        >
                          {tag}
                        </span>
                      ))}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        <div
          style={{
            border: "1px solid #E5E7EB",
            borderRadius: "12px",
            backgroundColor: "#FFFFFF",
            padding: "1rem",
            marginTop: "1.25rem"
          }}
        >
          <h2 style={{ marginTop: 0, marginBottom: "0.5rem", fontSize: "1.3rem", fontWeight: 700 }}>Lessons Learned</h2>
          <p style={{ marginTop: 0, color: "#6B7280", fontSize: "14px" }}>
            Create lessons with title, description, and image. Click a lesson image to open lightbox and pin spec references.
          </p>

          <form onSubmit={handleSaveLesson} style={{ display: "grid", gap: "0.75rem", marginTop: "0.75rem" }}>
            <div>
              <label style={{ fontSize: "14px", fontWeight: 600, color: "#374151" }}>Title</label>
              <input
                type="text"
                value={lessonForm.title}
                onChange={(event) => setLessonForm((prev) => ({ ...prev, title: event.target.value }))}
                placeholder="Example: Waterproofing transition detail"
                style={{ width: "100%", padding: "10px", borderRadius: "8px", border: "1px solid #E5E7EB", fontSize: "14px", marginTop: "6px" }}
              />
            </div>

            <div>
              <label style={{ fontSize: "14px", fontWeight: 600, color: "#374151" }}>Description</label>
              <textarea
                value={lessonForm.description}
                onChange={(event) => setLessonForm((prev) => ({ ...prev, description: event.target.value }))}
                placeholder="Describe what happened, why, and the prevention standard for future work."
                rows={4}
                style={{ width: "100%", padding: "10px", borderRadius: "8px", border: "1px solid #E5E7EB", fontSize: "14px", resize: "vertical", marginTop: "6px" }}
              />
            </div>

            <div>
              <label style={{ fontSize: "14px", fontWeight: 600, color: "#374151" }}>Image</label>
              <input type="file" accept="image/*" onChange={handleLessonImageChange} style={{ width: "100%", marginTop: "6px" }} />
              {lessonForm.imagePreviewUrl && (
                <img
                  src={lessonForm.imagePreviewUrl}
                  alt="Lesson preview"
                  style={{ marginTop: "10px", maxWidth: "220px", borderRadius: "8px", border: "1px solid #E5E7EB" }}
                />
              )}
            </div>

            <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
              <button
                type="submit"
                disabled={lessonsSaving}
                style={{
                  padding: "10px 14px",
                  backgroundColor: "#2563EB",
                  color: "white",
                  border: "none",
                  borderRadius: "8px",
                  fontWeight: "600",
                  cursor: lessonsSaving ? "not-allowed" : "pointer"
                }}
              >
                {lessonsSaving ? "Saving..." : editingLessonId ? "Update Lesson" : "Create Lesson"}
              </button>
              {editingLessonId && (
                <button
                  type="button"
                  onClick={resetLessonForm}
                  style={{
                    padding: "10px 14px",
                    backgroundColor: "white",
                    color: "#374151",
                    border: "1px solid #CBD5E1",
                    borderRadius: "8px",
                    fontWeight: "600",
                    cursor: "pointer"
                  }}
                >
                  Cancel Edit
                </button>
              )}
            </div>
          </form>

          <div style={{ marginTop: "1rem" }}>
            {lessonsLoading ? (
              <div style={{ color: "#6B7280" }}>Loading lessons...</div>
            ) : lessons.length === 0 ? (
              <div style={{ color: "#6B7280" }}>No lessons learned saved yet.</div>
            ) : (
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))", gap: "12px" }}>
                {lessons.map((lesson) => (
                  <div key={lesson.id} style={{ border: "1px solid #E5E7EB", borderRadius: "10px", overflow: "hidden", backgroundColor: "#FFFFFF" }}>
                    {lesson.imageUrl && (
                      <button
                        type="button"
                        onClick={() => openLightbox(lesson)}
                        style={{ border: "none", padding: 0, margin: 0, width: "100%", background: "transparent", cursor: "zoom-in" }}
                      >
                        <img src={lesson.imageUrl} alt={lesson.title || "Lesson image"} style={{ width: "100%", height: "170px", objectFit: "cover" }} />
                      </button>
                    )}
                    <div style={{ padding: "0.75rem" }}>
                      <div style={{ fontWeight: 700, color: "#111827", marginBottom: "6px" }}>{lesson.title || "Untitled"}</div>
                      <div style={{ color: "#111827", whiteSpace: "pre-wrap", marginBottom: "8px" }}>{lesson.description || "-"}</div>
                      <div style={{ fontSize: "12px", color: "#6B7280", marginBottom: "8px" }}>
                        Pins: {(Array.isArray(lesson.pins) ? lesson.pins.length : 0)}
                      </div>
                      <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
                        <button
                          type="button"
                          onClick={() => openLightbox(lesson)}
                          style={{ padding: "6px 10px", borderRadius: "6px", border: "1px solid #2563EB", color: "#2563EB", backgroundColor: "white", cursor: "pointer" }}
                        >
                          Open Lightbox
                        </button>
                        <button
                          type="button"
                          onClick={() => handleEditLesson(lesson)}
                          style={{ padding: "6px 10px", borderRadius: "6px", border: "1px solid #1D4ED8", color: "white", backgroundColor: "#2563EB", cursor: "pointer" }}
                        >
                          Edit
                        </button>
                        <button
                          type="button"
                          onClick={() => handleDeleteLesson(lesson)}
                          style={{ padding: "6px 10px", borderRadius: "6px", border: "1px solid #DC2626", color: "#DC2626", backgroundColor: "white", cursor: "pointer" }}
                        >
                          Delete
                        </button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      {lightboxLesson && (
        <div
          onClick={closeLightbox}
          style={{
            position: "fixed",
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            backgroundColor: "rgba(0,0,0,0.75)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 1300,
            padding: "16px"
          }}
        >
          <div
            onClick={(event) => event.stopPropagation()}
            style={{ backgroundColor: "#fff", borderRadius: "10px", width: "min(1100px, 96vw)", maxHeight: "92vh", overflow: "auto", padding: "14px" }}
          >
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "10px" }}>
              <div>
                <div style={{ fontSize: "1.1rem", fontWeight: 700 }}>{lightboxLesson.title || "Lesson"}</div>
                <div style={{ fontSize: "12px", color: "#6B7280" }}>
                  {isPinEditMode
                    ? "Edit mode: click anywhere on the image to place a pin."
                    : "View mode: existing pins only. Switch to Edit Pins to add a new one."}
                </div>
              </div>
              <div style={{ display: "flex", gap: "8px", alignItems: "center" }}>
                <button
                  type="button"
                  onClick={() => setLightboxMode("view")}
                  style={{
                    border: "1px solid #CBD5E1",
                    backgroundColor: !isPinEditMode ? "#EEF2FF" : "white",
                    color: "#1F2937",
                    borderRadius: "6px",
                    padding: "6px 10px",
                    cursor: "pointer",
                    fontWeight: !isPinEditMode ? "700" : "500"
                  }}
                >
                  View
                </button>
                <button
                  type="button"
                  onClick={() => setLightboxMode("edit")}
                  style={{
                    border: "1px solid #1D4ED8",
                    backgroundColor: isPinEditMode ? "#2563EB" : "white",
                    color: isPinEditMode ? "white" : "#1D4ED8",
                    borderRadius: "6px",
                    padding: "6px 10px",
                    cursor: "pointer",
                    fontWeight: isPinEditMode ? "700" : "500"
                  }}
                >
                  Edit Pins
                </button>
                <button
                  type="button"
                  onClick={closeLightbox}
                  style={{ border: "1px solid #CBD5E1", backgroundColor: "white", borderRadius: "6px", padding: "6px 10px", cursor: "pointer" }}
                >
                  Close
                </button>
              </div>
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr) 320px", gap: "12px" }}>
              <div style={{ border: "1px solid #E5E7EB", borderRadius: "8px", overflow: "hidden", position: "relative", backgroundColor: "#F8FAFC" }}>
                <img
                  src={lightboxLesson.imageUrl}
                  alt={lightboxLesson.title || "Lesson"}
                  onClick={isPinEditMode ? handleImageClickForPin : undefined}
                  style={{ width: "100%", display: "block", cursor: isPinEditMode ? "crosshair" : "default", userSelect: "none" }}
                />

                {(Array.isArray(lightboxLesson.pins) ? lightboxLesson.pins : []).map((pin) => (
                  <div
                    key={pin.id}
                    role="button"
                    tabIndex={0}
                    onClick={(event) => {
                      event.stopPropagation();
                      handleSelectPin(pin.id);
                    }}
                    onKeyDown={(event) => {
                      if (event.key === "Enter" || event.key === " ") {
                        event.preventDefault();
                        event.stopPropagation();
                        handleSelectPin(pin.id);
                      }
                    }}
                    title={`${pin.specUniqueId || ""} ${pin.specReference || ""}`.trim()}
                    style={{
                      position: "absolute",
                      left: `${pin.x}%`,
                      top: `${pin.y}%`,
                      transform: "translate(-50%, -50%)",
                      width: "16px",
                      height: "16px",
                      borderRadius: "50%",
                      backgroundColor: selectedPinId === pin.id ? "#2563EB" : "#DC2626",
                      border: "2px solid #fff",
                      boxShadow: "0 0 0 1px rgba(0,0,0,0.2)",
                      cursor: "pointer",
                      outline: "none"
                    }}
                  />
                ))}

                {pendingPin && (
                  <div
                    style={{
                      position: "absolute",
                      left: `${pendingPin.x}%`,
                      top: `${pendingPin.y}%`,
                      transform: "translate(-50%, -50%)",
                      width: "16px",
                      height: "16px",
                      borderRadius: "999px",
                      backgroundColor: "#2563EB",
                      border: "2px solid #fff",
                      boxShadow: "0 0 0 1px rgba(0,0,0,0.2)",
                      pointerEvents: "none"
                    }}
                  />
                )}
              </div>

              <div style={{ border: "1px solid #E5E7EB", borderRadius: "8px", padding: "10px" }}>
                <h3 style={{ marginTop: 0, marginBottom: "8px", fontSize: "1rem" }}>New Pin</h3>
                <div style={{ fontSize: "12px", color: "#6B7280", marginBottom: "8px" }}>
                  {!isPinEditMode
                    ? "Switch to Edit Pins mode to place a new pin."
                    : pendingPin
                      ? `Position: ${pendingPin.x}%, ${pendingPin.y}%`
                      : "Click image to set pin position."}
                </div>
                <select
                  value={pendingPinSpecId}
                  onChange={(event) => setPendingPinSpecId(event.target.value)}
                  disabled={!isPinEditMode}
                  style={{ width: "100%", padding: "9px", borderRadius: "6px", border: "1px solid #CBD5E1", marginBottom: "8px" }}
                >
                  <option value="">Select associated spec</option>
                  {items.map((spec) => (
                    <option key={spec.id} value={spec.id}>
                      {(spec.uniqueId || "No ID") + " - " + (spec.specReference || "No reference")}
                    </option>
                  ))}
                </select>
                <button
                  type="button"
                  onClick={handleSavePin}
                  disabled={!isPinEditMode || pinSaving || !pendingPin || !pendingPinSpecId}
                  style={{
                    width: "100%",
                    padding: "9px",
                    borderRadius: "6px",
                    border: "1px solid #1D4ED8",
                    backgroundColor: "#2563EB",
                    color: "white",
                    fontWeight: "600",
                    cursor: !isPinEditMode || pinSaving || !pendingPin || !pendingPinSpecId ? "not-allowed" : "pointer"
                  }}
                >
                  {pinSaving ? "Saving Pin..." : "Save Pin"}
                </button>

                <h3 style={{ marginTop: "14px", marginBottom: "8px", fontSize: "1rem" }}>Existing Pins</h3>
                <div style={{ display: "grid", gap: "6px", maxHeight: "260px", overflowY: "auto" }}>
                  {(Array.isArray(lightboxLesson.pins) ? lightboxLesson.pins : []).length === 0 ? (
                    <div style={{ color: "#6B7280", fontSize: "12px" }}>No pins yet.</div>
                  ) : (
                    (Array.isArray(lightboxLesson.pins) ? lightboxLesson.pins : []).map((pin) => (
                      <div
                        key={pin.id}
                        onClick={() => handleSelectPin(pin.id)}
                        style={{
                          border: selectedPinId === pin.id ? "1px solid #2563EB" : "1px solid #E5E7EB",
                          borderRadius: "6px",
                          padding: "6px",
                          cursor: "pointer",
                          backgroundColor: selectedPinId === pin.id ? "#EFF6FF" : "white"
                        }}
                      >
                        <div style={{ fontSize: "12px", fontWeight: 600, color: "#111827" }}>{pin.specUniqueId || "No ID"}</div>
                        <div style={{ fontSize: "12px", color: "#374151", marginTop: "2px" }}>{pin.specReference || "No spec reference"}</div>
                        <div style={{ fontSize: "11px", color: "#6B7280", marginTop: "2px" }}>({pin.x}%, {pin.y}%)</div>
                        <button
                          type="button"
                          onClick={() => handleDeletePin(pin.id)}
                          style={{
                            marginTop: "6px",
                            padding: "4px 8px",
                            borderRadius: "6px",
                            border: "1px solid #DC2626",
                            backgroundColor: "white",
                            color: "#DC2626",
                            cursor: "pointer",
                            fontSize: "12px"
                          }}
                        >
                          Delete Pin
                        </button>
                      </div>
                    ))
                  )}
                </div>

                <h3 style={{ marginTop: "14px", marginBottom: "8px", fontSize: "1rem" }}>Selected Pin Details</h3>
                {!selectedPin ? (
                  <div style={{ color: "#6B7280", fontSize: "12px" }}>Click a pin on the image or in the list to view details.</div>
                ) : (
                  <div style={{ border: "1px solid #E5E7EB", borderRadius: "6px", padding: "8px", backgroundColor: "#F8FAFC" }}>
                    <div style={{ fontSize: "12px", color: "#6B7280" }}>Spec ID</div>
                    <div style={{ fontWeight: 700, color: "#111827", marginBottom: "6px" }}>{selectedPinUniqueId}</div>

                    <div style={{ fontSize: "12px", color: "#6B7280" }}>Spec Reference</div>
                    <div style={{ color: "#111827", marginBottom: "6px" }}>{selectedPinReference}</div>

                    <div style={{ fontSize: "12px", color: "#6B7280" }}>Spec Note</div>
                    <div style={{ color: "#111827", whiteSpace: "pre-wrap", marginBottom: "6px" }}>{selectedPinNote}</div>

                    <div style={{ fontSize: "12px", color: "#6B7280" }}>Category Tags</div>
                    <div style={{ display: "flex", flexWrap: "wrap", gap: "6px", marginBottom: "6px" }}>
                      {selectedPinCategories.length === 0 ? (
                        <span style={{ color: "#6B7280", fontSize: "12px" }}>No tags</span>
                      ) : (
                        selectedPinCategories.map((tag) => (
                          <span
                            key={`pin-detail-${selectedPin.id}-${tag}`}
                            style={{
                              fontSize: "12px",
                              padding: "4px 8px",
                              borderRadius: "999px",
                              backgroundColor: "#EEF2FF",
                              color: "#3730A3",
                              border: "1px solid #C7D2FE"
                            }}
                          >
                            {tag}
                          </span>
                        ))
                      )}
                    </div>

                    <div style={{ fontSize: "12px", color: "#6B7280" }}>Pin Coordinates</div>
                    <div style={{ color: "#111827", marginBottom: "6px" }}>{selectedPin.x}%, {selectedPin.y}%</div>

                    <div style={{ fontSize: "12px", color: "#6B7280" }}>Created</div>
                    <div style={{ color: "#111827" }}>
                      {selectedPin.createdAt ? new Date(selectedPin.createdAt).toLocaleString() : "Unknown"}
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default MiOrganizacionBimQc;
