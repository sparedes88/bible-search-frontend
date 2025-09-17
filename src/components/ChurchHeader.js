import React, { useState, useEffect } from "react";
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
import { doc, updateDoc } from "@firebase/firestore";
import { db, storage } from "../firebase";
import { toast, ToastContainer } from "react-toastify";

const ChurchHeader = ({
  id,
  applyShadow = true,
  allowEditBannerLogo = false,
}) => {
  const [church, setChurch] = useState(null);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [refresh, setRefresh] = useState(false);
  const [preview, setPreview] = useState({ banner: null, logo: null });

  useEffect(() => {
    const fetchChurch = async () => {
      try {
        const data = await getChurchData(id);
        if (data) {
          setChurch(data);
        }
      } catch (error) {
        console.error("Error fetching church:", error);
      }
      setLoading(false);
    };

    if (id) {
      fetchChurch();
    }
  }, [id, refresh]);

  const handleFileUpload = async (event, field) => {
    const file = event.target.files[0];
    if (!file || !id) return;

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
      const filePath = `/churches/church_${id}/${uniqueFileName}`;
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
      const churchRef = doc(db, "churches", id);
      await updateDoc(churchRef, { [field]: filePath });

      toast.success("Changes saved successfully!");
      setRefresh((prev) => !prev);
    } catch (error) {
      console.error("Error uploading file:", error);
      toast.error(`Failed to save changes`);
    }

    setUploading(false);
  };

  return (
    <div
      style={{
        boxShadow: applyShadow ? "0 2px 8px rgba(0,0,0,0.1)" : "none",
        width: "100%",
        margin: "0 auto 40px",
        backgroundColor: "white",
        borderRadius: "12px",
        overflow: "hidden",
        position: "relative",
      }}
    >
      <ToastContainer />
      <div style={{ ...commonStyles.banner, position: "relative" }}>
        {loading || uploading ? (
          <Skeleton height={200} />
        ) : (
          <>
            <img
              src={
                preview.banner || church?.banner || "/img/banner-fallback.svg"
              }
              alt="Church Banner"
              style={commonStyles.bannerImage}
            />
            {allowEditBannerLogo && (
              <label
                style={{
                  position: "absolute",
                  top: "10px",
                  right: "10px",
                  backgroundColor: "rgba(0, 0, 0, 0.6)",
                  padding: "5px 8px 8px 10px",
                  borderRadius: "50%",
                  cursor: "pointer",
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
            )}
          </>
        )}
      </div>
      <div style={{ ...commonStyles.logoContainer }}>
        {loading || uploading ? (
          <Skeleton circle height={90} width={90} />
        ) : (
          <div style={{ position: "relative" }}>
            <img
              src={preview.logo || church?.logo || "/img/logo-fallback.svg"}
              alt="Church Logo"
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
      {loading ? (
        <div style={{ textAlign: "center", margin:"30px" }}>
          <Skeleton width={300} height={30} />
        </div>
      ) : (
        <h2 className="church-name">{church?.nombre || ""}</h2>
      )}
    </div>
  );
};

export default ChurchHeader;
