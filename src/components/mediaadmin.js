import React, { useEffect, useState } from "react";
import { db, storage } from "../firebase"; // Import storage from firebase
import { collection, getDocs, doc, updateDoc } from "firebase/firestore";
import { ref, uploadBytes, getDownloadURL } from "firebase/storage"; // Import necessary functions from firebase/storage
import { useNavigate, useParams } from "react-router-dom";
import { useAuth } from "../contexts/AuthContext";
import Select from 'react-select';
import 'bootstrap/dist/css/bootstrap.min.css';
import './Admin.css';

const MediaAdmin = () => {
  const { user } = useAuth(); // *New*Get user from useAuth
  const [mediaItems, setMediaItems] = useState([]);
  const [playlists, setPlaylists] = useState([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState("");
  const [currentPage, setCurrentPage] = useState(1);
  const [itemsPerPage] = useState(10);
  const [isChanged, setIsChanged] = useState(false);
  const [visibleColumns, setVisibleColumns] = useState({
    title: true,
    short_desc: true,
    playlist: true,
    id_playlist: true,
    churchId: true,
    speaker: true,
    file_upload: true, // Add file_upload to visibleColumns
  });
  const navigate = useNavigate();
  const { id } = useParams();

  const columnOptions = [
    { value: 'title', label: 'Title' },
    { value: 'short_desc', label: 'Short Desc' },
    { value: 'playlist', label: 'Playlist' },
    { value: 'id_playlist', label: 'ID Playlist' },
    { value: 'churchId', label: 'Church ID' },
    { value: 'speaker', label: 'Speaker' },
    { value: 'file_upload', label: 'File Upload' }, // Add file_upload to columnOptions
  ];

  const predefinedOptions = [
    { value: 'manage_media', label: 'Manage Media' },
    { value: 'playlists', label: 'Playlists' },
  ];

  useEffect(() => {
    if (user?.role !== "admin" && user?.role !== "global_admin") {
      navigate("/not-authorized"); // Redirect non-admins
      return;
    }
    setLoading(true);
    const fetchMediaItems = async () => {
      try {
        const mediaQuerySnapshot = await getDocs(collection(db, "media"));
        const mediaData = mediaQuerySnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
        setMediaItems(mediaData);
      } catch (error) {
        console.error("Error fetching media items:", error);
      }
    };

    const fetchPlaylists = async () => {
      try {
        const playlistQuerySnapshot = await getDocs(collection(db, "syncChurchPlaylist"));
        const playlistData = playlistQuerySnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
        setPlaylists(playlistData);
      } catch (error) {
        console.error("Error fetching playlists:", error);
      }
    };

    fetchMediaItems();
    fetchPlaylists();
    setLoading(false);
  }, [user, navigate]);

  const handleInputChange = (e, itemId, field, index = null) => {
    const { value } = e.target;
    setMediaItems(prevItems =>
      prevItems.map(item => {
        if (item.id === itemId) {
          if (index !== null) {
            const updatedMediaFiles = [...item.media_files];
            updatedMediaFiles[index] = { ...updatedMediaFiles[index], [field]: value };
            return { ...item, media_files: updatedMediaFiles, updated: true };
          }
          return { ...item, [field]: value, updated: true };
        }
        return item;
      })
    );
    setIsChanged(true);
  };

  const handleDateChange = (e, itemId) => {
    const { value } = e.target;
    setMediaItems(prevItems =>
      prevItems.map(item =>
        item.id === itemId ? { ...item, publish_date: value, updated: true } : item
      )
    );
    setIsChanged(true);
  };

  const handleFileUpload = async (e, itemId, index) => {
    const file = e.target.files[0];
    if (!file) return;

    const storageRef = ref(storage, `media/${itemId}/${file.name}`);
    try {
      await uploadBytes(storageRef, file);
      const downloadURL = await getDownloadURL(storageRef);
      setMediaItems(prevItems =>
        prevItems.map(item => {
          if (item.id === itemId) {
            const updatedMediaFiles = [...item.media_files];
            updatedMediaFiles[index] = { ...updatedMediaFiles[index], file_url: downloadURL };
            return { ...item, media_files: updatedMediaFiles, updated: true };
          }
          return item;
        })
      );
      setIsChanged(true);
    } catch (error) {
      console.error("Error uploading file:", error);
    }
  };

  const handleSave = async (itemId) => {
    const item = mediaItems.find(item => item.id === itemId);
    const updatedFields = Object.keys(item).reduce((acc, key) => {
      if (visibleColumns[key] && key !== 'id' && key !== 'updated' && item[key] !== undefined) {
        acc[key] = item[key];
      }
      return acc;
    }, {});

    try {
      await updateDoc(doc(db, "media", itemId), updatedFields);
      alert("Media item updated successfully");
      setIsChanged(false);
    } catch (error) {
      console.error("Error updating media item:", error);
      alert("Error updating media item");
    }
  };

  const handleBackClick = () => {
    navigate(`/church/${id}/mi-perfil`);
  };

  const handleSearchChange = (e) => {
    setSearchTerm(e.target.value);
  };

  const handleColumnToggle = (selectedOptions) => {
    const selectedColumns = selectedOptions ? selectedOptions.map(option => option.value) : [];
    const newVisibleColumns = columnOptions.reduce((acc, column) => {
      acc[column.value] = selectedColumns.includes(column.value);
      return acc;
    }, {});
    setVisibleColumns(newVisibleColumns);
  };

  const handlePredefinedOptionChange = (selectedOption) => {
    let newVisibleColumns = {};
    if (selectedOption.value === 'manage_media') {
      newVisibleColumns = {
        title: true,
        short_desc: true,
        playlist: true,
        id_playlist: true,
        churchId: true,
        speaker: true,
        file_upload: true,
      };
    } else if (selectedOption.value === 'playlists') {
      newVisibleColumns = {
        idPlaylist: true,
        playlist_name: true,
      };
    }
    setVisibleColumns(newVisibleColumns);
    handleColumnToggle(Object.keys(newVisibleColumns).map(key => ({ value: key, label: columnOptions.find(option => option.value === key).label })));
  };

  const filteredMediaItems = mediaItems.filter(item =>
    (item.title?.toLowerCase().includes(searchTerm.toLowerCase()) ||
    item.description?.toLowerCase().includes(searchTerm.toLowerCase()) ||
    item.type?.toLowerCase().includes(searchTerm.toLowerCase()) ||
    item.publish_date?.toLowerCase().includes(searchTerm.toLowerCase()) ||
    (item.idPlaylist && item.idPlaylist.toString().toLowerCase().includes(searchTerm.toLowerCase())))
  );

  const indexOfLastItem = currentPage * itemsPerPage;
  const indexOfFirstItem = indexOfLastItem - itemsPerPage;
  const currentMediaItems = filteredMediaItems.slice(indexOfFirstItem, indexOfLastItem);

  const totalPages = Math.ceil(filteredMediaItems.length / itemsPerPage);

  return (
    <div className="admin-container">
      <button className="back-button" onClick={handleBackClick}>⬅ Back</button>
      <h2 className="header">Admin Panel - Media</h2>
      <input
        className="search-input"
        type="text"
        placeholder="Search by title, description, type, or other fields"
        value={searchTerm}
        onChange={handleSearchChange}
      />
      <Select
        options={predefinedOptions}
        onChange={handlePredefinedOptionChange}
        placeholder="Select predefined column set"
        defaultValue={predefinedOptions[0]}
      />
      <Select
        isMulti
        options={columnOptions}
        onChange={handleColumnToggle}
        placeholder="Select columns to display"
      />
      {loading ? (
        <p>Loading media items...</p>
      ) : (
        <table className="table">
          <thead>
            <tr>
              {visibleColumns.title && <th className="table-header">Title</th>}
              {visibleColumns.short_desc && <th className="table-header">Short Desc</th>}
              {visibleColumns.playlist && <th className="table-header">Playlist</th>}
              {visibleColumns.id_playlist && <th className="table-header">ID Playlist</th>}
              {visibleColumns.churchId && <th className="table-header">Church ID</th>}
              {visibleColumns.speaker && <th className="table-header">Speaker</th>}
              {visibleColumns.file_upload && <th className="table-header">File Upload</th>}
              <th className="table-header">Actions</th>
            </tr>
          </thead>
          <tbody>
            {currentMediaItems.map(item => (
              item.media_files.map((file, index) => {
                const playlist = playlists.find(playlist => playlist.id === item.idPlaylist && playlist.churchId === item.churchId);
                const playlistName = playlist ? `${playlist.name}` : "";
                return (
                  <tr className="table-row" key={`${item.id}-${index}`}>
                    {visibleColumns.title && (
                      <td className="table-cell">
                        <input
                          className="input"
                          type="text"
                          value={file.title || ""}
                          onChange={(e) => handleInputChange(e, item.id, "title", index)}
                        />
                      </td>
                    )}
                    {visibleColumns.short_desc && (
                      <td className="table-cell">
                        <input
                          className="input"
                          type="text"
                          value={file.description || ""}
                          onChange={(e) => handleInputChange(e, item.id, "description", index)}
                        />
                      </td>
                    )}
                    {visibleColumns.playlist && (
                      <td className="table-cell">
                        {playlistName}
                      </td>
                    )}
                    {visibleColumns.id_playlist && (
                      <td className="table-cell">
                        {item.idPlaylist || ""}
                      </td>
                    )}
                    {visibleColumns.churchId && (
                      <td className="table-cell">
                        {item.churchId || ""}
                      </td>
                    )}
                    {visibleColumns.speaker && (
                      <td className="table-cell">
                        <input
                          className="input"
                          type="text"
                          value={file.speaker || ""}
                          onChange={(e) => handleInputChange(e, item.id, "speaker", index)}
                        />
                      </td>
                    )}
                    {visibleColumns.file_upload && (
                      <td className="table-cell">
                        <input
                          type="file"
                          onChange={(e) => handleFileUpload(e, item.id, index)}
                        />
                      </td>
                    )}
                    <td className="table-cell">
                      <button className={`save-button ${isChanged ? 'is-changed' : ''}`} onClick={() => handleSave(item.id)} disabled={!isChanged}>Save</button>
                    </td>
                  </tr>
                );
              })
            ))}
          </tbody>
        </table>
      )}
      <div className="pagination-container">
        <button
          className="pagination-button"
          onClick={() => setCurrentPage(prevPage => Math.max(prevPage - 1, 1))}
          disabled={currentPage === 1}
        >
          Previous
        </button>
        {Array.from({ length: totalPages }, (_, index) => (
          <button
            key={index + 1}
            className="pagination-button"
            onClick={() => setCurrentPage(index + 1)}
            disabled={currentPage === index + 1}
          >
            {index + 1}
          </button>
        ))}
        <button
          className="pagination-button"
          onClick={() => setCurrentPage(prevPage => Math.min(prevPage + 1, totalPages))}
          disabled={currentPage === totalPages}
        >
          Next
        </button>
      </div>
    </div>
  );
};

export default MediaAdmin;