import React, { useState, useEffect, useRef } from "react";
import Skeleton from "react-loading-skeleton";
import "react-loading-skeleton/dist/skeleton.css";
import { FaEdit } from "react-icons/fa";
import commonStyles from "../pages/commonStyles";
import { getChurchData } from "../api/church";
import {
  deleteObject,
  getDownloadURL,
  ref,
  uploadBytes,
} from "firebase/storage";
import { doc, updateDoc } from "firebase/firestore";
import { db, storage } from "../firebase";
import { toast, ToastContainer } from "react-toastify";

const ChurchHeader = ({
  id,
  churchId,
  applyShadow = true,
  allowEditBannerLogo = false,
  showOrganizationName = true,
}) => {
  const organizationId = id || churchId;

  const [church, setChurch] = useState(null);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [refresh, setRefresh] = useState(false);
  const [preview, setPreview] = useState({ banner: null, logo: null });
  const [bannerPositionY, setBannerPositionY] = useState(0);
  const [bannerHeight, setBannerHeight] = useState(440);
  const [isDraggingBanner, setIsDraggingBanner] = useState(false);
  const [isResizingBanner, setIsResizingBanner] = useState(false);
  const dragStartYRef = useRef(0);
  const dragStartOffsetRef = useRef(0);
  const resizeStartYRef = useRef(0);
  const resizeStartHeightRef = useRef(440);
  const hasLoadedBannerStateRef = useRef(false);
  const lastSavedBannerStateRef = useRef({ position: 0, height: 440 });

  useEffect(() => {
    const fetchChurch = async () => {
      try {
        const data = await getChurchData(organizationId);
        if (data) {
          const initialPosition = Number.isFinite(Number(data.bannerPositionY)) ? Number(data.bannerPositionY) : 0;
          const rawHeight = Number(data.bannerHeight);
          const normalizedHeight = Number.isFinite(rawHeight)
            ? (rawHeight <= 420 ? rawHeight * 2 : rawHeight)
            : 440;
          const initialHeight = Math.max(440, Math.min(840, normalizedHeight));
          setBannerPositionY(initialPosition);
          setBannerHeight(initialHeight);
          lastSavedBannerStateRef.current = { position: initialPosition, height: initialHeight };
          hasLoadedBannerStateRef.current = true;
          setChurch(data);
        }
      } catch (error) {
        console.error("Error fetching church:", error);
      }
      setLoading(false);
    };

    if (organizationId) {
      fetchChurch();
    }
  }, [organizationId, refresh]);

  const handleFileUpload = async (event, field) => {
    const file = event.target.files[0];
    if (!file || !organizationId) return;

    // Check if storage is available
    if (!storage) {
      toast.error("File storage is not available. Please try again later.");
      return;
    }

    // Validate file type
    const validTypes = ["image/jpeg", "image/png", "image/jpg"];
    if (!validTypes.includes(file.type)) {
      toast.error("File doesn't have a valid type");
      return;
    }

    // Validate file size (5MB limit)
    const maxSize = 5 * 1024 * 1024; // 5MB in bytes
    if (file.size > maxSize) {
      toast.error("File size exceeds 5MB limit");
      return;
    }

    // Set preview
    const fileURL = URL.createObjectURL(file);
    setPreview((prev) => ({ ...prev, [field]: fileURL }));

    setUploading(true);
    try {
      const uniqueFileName = `${field}-${Date.now()}-${file.name}`;
      const filePath = `/churches/church_${organizationId}/${uniqueFileName}`;
      const fileRef = ref(storage, filePath);

      // Delete previous file if exists
      const previousFileUrl = church?.[field];
      if (previousFileUrl) {
        const previousFileRef = ref(storage, previousFileUrl);
        await deleteObject(previousFileRef).catch((error) => {
          console.warn("Error deleting old file:", error);
        });
      }

      // Validate file type
      const validTypes = ["image/jpeg", "image/png", "image/jpg"];
      if (!validTypes.includes(file.type)) {
        toast.error("File doesn't have a valid type");
        return;
      }

      //Add new file
      await uploadBytes(fileRef, file);
      const downloadURL = await getDownloadURL(fileRef);

      // Update church document
      const churchRef = doc(db, "churches", organizationId);
      await updateDoc(churchRef, { [field]: filePath });

      toast.success("Changes saved successfully!");
      setRefresh((prev) => !prev);
    } catch (error) {
      console.error("Error uploading file:", error);
      toast.error(`Failed to save changes`);
    }

    setUploading(false);
  };

  const clampBannerOffset = (value) => Math.max(-160, Math.min(160, value));
  const clampBannerHeight = (value) => Math.max(220, Math.min(840, value));

  const startBannerDrag = (clientY) => {
    if (!allowEditBannerLogo) return;
    dragStartYRef.current = clientY;
    dragStartOffsetRef.current = bannerPositionY;
    setIsDraggingBanner(true);
  };

  const startBannerResize = (clientY) => {
    if (!allowEditBannerLogo) return;
    resizeStartYRef.current = clientY;
    resizeStartHeightRef.current = bannerHeight;
    setIsResizingBanner(true);
  };

  const persistBannerLayout = async ({ showToastOnError = true } = {}) => {
    if (!organizationId) return;
    try {
      await updateDoc(doc(db, "churches", organizationId), {
        bannerPositionY: bannerPositionY,
        bannerHeight: bannerHeight,
      });
      lastSavedBannerStateRef.current = { position: bannerPositionY, height: bannerHeight };
    } catch (error) {
      console.error("Error saving banner position:", error);
      if (showToastOnError) {
        toast.error("Failed to auto-save banner position");
      }
    }
  };

  useEffect(() => {
    if (!allowEditBannerLogo || loading || !hasLoadedBannerStateRef.current || !organizationId) {
      return undefined;
    }

    const positionChanged = bannerPositionY !== lastSavedBannerStateRef.current.position;
    const heightChanged = bannerHeight !== lastSavedBannerStateRef.current.height;

    if (!positionChanged && !heightChanged) {
      return undefined;
    }

    const autoSaveTimer = setTimeout(() => {
      persistBannerLayout({ showToastOnError: false });
    }, 550);

    return () => clearTimeout(autoSaveTimer);
  }, [bannerPositionY, bannerHeight, allowEditBannerLogo, loading, organizationId]);

  useEffect(() => {
    if (!isDraggingBanner && !isResizingBanner) return undefined;

    const handleMouseMove = (event) => {
      if (isDraggingBanner) {
        const deltaY = event.clientY - dragStartYRef.current;
        setBannerPositionY(clampBannerOffset(dragStartOffsetRef.current + deltaY));
      }
      if (isResizingBanner) {
        const deltaY = event.clientY - resizeStartYRef.current;
        setBannerHeight(clampBannerHeight(resizeStartHeightRef.current + deltaY));
      }
    };

    const handleTouchMove = (event) => {
      if (!event.touches || !event.touches[0]) return;
      if (isDraggingBanner) {
        const deltaY = event.touches[0].clientY - dragStartYRef.current;
        setBannerPositionY(clampBannerOffset(dragStartOffsetRef.current + deltaY));
      }
      if (isResizingBanner) {
        const deltaY = event.touches[0].clientY - resizeStartYRef.current;
        setBannerHeight(clampBannerHeight(resizeStartHeightRef.current + deltaY));
      }
      event.preventDefault();
    };

    const stopDrag = () => {
      setIsDraggingBanner(false);
      setIsResizingBanner(false);
    };

    window.addEventListener("mousemove", handleMouseMove);
    window.addEventListener("mouseup", stopDrag);
    window.addEventListener("touchmove", handleTouchMove, { passive: false });
    window.addEventListener("touchend", stopDrag);

    return () => {
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("mouseup", stopDrag);
      window.removeEventListener("touchmove", handleTouchMove);
      window.removeEventListener("touchend", stopDrag);
    };
  }, [isDraggingBanner, isResizingBanner, allowEditBannerLogo]);

  return (
    <div
      className="church-header-container"
      style={{
        boxShadow: applyShadow ? "0 2px 8px rgba(0,0,0,0.1)" : "none",
        width: "100%",
        maxWidth: "100%",
        margin: "0 auto 40px",
        backgroundColor: "white",
        borderRadius: "12px",
        overflow: "hidden",
        position: "relative",
        paddingLeft: 0,
        paddingRight: 0,
      }}
    >
      <ToastContainer />
      <div 
        className="banner-container church-header-banner"
        style={{
          "--church-banner-height": `${bannerHeight}px`,
          position: "relative",
        }}
      >
        {loading || uploading ? (
          <Skeleton height={300} style={{ width: "100%" }} />
        ) : (
          <>
            <img
              className="church-banner-image"
              src={
                preview.banner || church?.banner || "/img/banner-fallback.svg"
              }
              alt="Church Banner"
              onError={(event) => {
                event.currentTarget.onerror = null;
                event.currentTarget.src = "/img/banner-fallback.svg";
              }}
              draggable={false}
              onDragStart={(event) => event.preventDefault()}
              onMouseDown={(event) => {
                event.preventDefault();
                startBannerDrag(event.clientY);
              }}
              onTouchStart={(event) => {
                if (!event.touches || !event.touches[0]) return;
                event.preventDefault();
                startBannerDrag(event.touches[0].clientY);
              }}
              style={{
                objectPosition: "center center",
                transform: allowEditBannerLogo ? `translateY(${bannerPositionY}px)` : "translateY(0px)",
                transition: isDraggingBanner ? "none" : "transform 120ms ease-out",
                cursor: allowEditBannerLogo ? (isDraggingBanner ? "grabbing" : "grab") : "default",
                touchAction: allowEditBannerLogo ? "none" : "auto",
                userSelect: "none",
                WebkitUserDrag: "none",
              }}
            />
            {allowEditBannerLogo && (
              <>
                <label
                  style={{
                    position: "absolute",
                    top: "10px",
                    right: "10px",
                    backgroundColor: "rgba(0, 0, 0, 0.6)",
                    padding: "5px 8px 8px 10px",
                    borderRadius: "50%",
                    cursor: "pointer",
                    zIndex: 2,
                  }}
                >
                  <FaEdit color="white" size={16} />
                  <input
                    type="file"
                    style={{ display: "none" }}
                    onChange={(e) => handleFileUpload(e, "banner")}
                    accept=".png,.jpg,.jpeg"
                    disabled={uploading}
                  />
                </label>
                <div
                  role="button"
                  tabIndex={0}
                  onMouseDown={(event) => {
                    event.preventDefault();
                    startBannerResize(event.clientY);
                  }}
                  onTouchStart={(event) => {
                    if (!event.touches || !event.touches[0]) return;
                    event.preventDefault();
                    startBannerResize(event.touches[0].clientY);
                  }}
                  onKeyDown={(event) => {
                    if (event.key === "ArrowUp") {
                      event.preventDefault();
                      setBannerHeight((previous) => clampBannerHeight(previous - 20));
                    }
                    if (event.key === "ArrowDown") {
                      event.preventDefault();
                      setBannerHeight((previous) => clampBannerHeight(previous + 20));
                    }
                  }}
                  style={{
                    position: "absolute",
                    left: "50%",
                    bottom: "12px",
                    transform: "translateX(-50%)",
                    width: "56px",
                    height: "8px",
                    borderRadius: "9999px",
                    backgroundColor: "rgba(15, 23, 42, 0.55)",
                    cursor: isResizingBanner ? "ns-resize" : "row-resize",
                    zIndex: 2,
                  }}
                />
              </>
            )}
          </>
        )}
      </div>
      <div
        className="church-header-logo-wrap"
        style={{
          ...commonStyles.logoContainer,
          marginTop: "-90px",
          marginBottom: "16px",
          position: "relative",
          zIndex: 6,
        }}
      >
        {loading || uploading ? (
          <Skeleton circle height={90} width={90} />
        ) : (
          <div
            className="church-header-logo-shell"
            style={{
              position: "relative",
              backgroundColor: "#FFFFFF",
              borderRadius: "9999px",
              padding: "12px",
              border: "1px solid #E5E7EB",
              boxShadow: "0 6px 16px rgba(15, 23, 42, 0.12)",
            }}
          >
            <img
              className="church-header-logo-image"
              src={preview.logo || church?.logo || "/img/logo-fallback.svg"}
              alt="Church Logo"
              onError={(event) => {
                event.currentTarget.onerror = null;
                event.currentTarget.src = "/img/logo-fallback.svg";
              }}
              style={commonStyles.logo}
            />
            {allowEditBannerLogo && (
              <label
                style={{
                  position: "absolute",
                  bottom: "-8px",
                  right: "0",
                  backgroundColor: "rgba(0, 0, 0, 0.6)",
                  padding: "4px 8px 6px 10px",
                  borderRadius: "50%",
                  cursor: "pointer",
                }}
              >
                <FaEdit color="white" size={14} />
                <input
                  type="file"
                  style={{ display: "none" }}
                  onChange={(e) => handleFileUpload(e, "logo")}
                  accept=".png,.jpg,.jpeg"
                  disabled={uploading}
                />
              </label>
            )}
          </div>
        )}
      </div>
      {showOrganizationName ? (
        loading ? (
          <div style={{ textAlign: "center", margin:"30px" }}>
            <Skeleton width={300} height={30} />
          </div>
        ) : (
          <h2 className="church-name">{church?.nombre || ""}</h2>
        )
      ) : null}
    </div>
  );
};

export default ChurchHeader;
