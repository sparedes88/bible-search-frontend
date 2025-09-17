import React, { useEffect, useState } from "react";
import { db, storage } from "../firebase";
import {
  doc,
  getDoc,
  updateDoc,
  collection,
  getDocs,
} from "firebase/firestore";
import Select from "react-select";
import CreatableSelect from "react-select/creatable";
import AsyncCreatableSelect from "react-select/async-creatable";
import Skeleton from "react-loading-skeleton";
import "react-loading-skeleton/dist/skeleton.css";
import commonStyles from "../pages/commonStyles";
import "./Sobre.css"; // Import the CSS file
import ocupaciones from "./ocupaciones"; // Import the catalog of professions
import nacionalidades from "./nacionalidades"; // Import the catalog of nationalities
import idiomas from "./idiomas"; // Import the catalog of languages
import habilidades from "./habilidades"; // Import the catalog of skills
import ChurchHeader from "./ChurchHeader";
import { useParams } from "react-router-dom";
import "./Sobre.css";
import { FaEdit } from "react-icons/fa";
import {
  deleteObject,
  getDownloadURL,
  ref,
  uploadBytes,
} from "firebase/storage";
import { toast } from "react-toastify";
import { useAuth } from "../contexts/AuthContext";
import { fetchGroupList } from "../api/church";
import { Spinner } from "react-bootstrap";
import { format } from 'date-fns'; // Add this import
import { countries, validatePostalCode, formatPostalCode } from './data/locations';

const Sobre = () => {
  const { id } = useParams();
  const { user } = useAuth();
  const [userData, setUserData] = useState({});
  const [loading, setLoading] = useState(true);
  const [isUpdated, setIsUpdated] = useState(false);
  const [previewProfile, setPreviewProfile] = useState(null);
  const [uploadingProfile, setUploadingProfile] = useState(false);
  const [addingGroup, setAddingGroup] = useState(false);
  const [groups, setGroups] = useState([]);
  const [selectedGroups, setSelectedGroups] = useState([]);
  const [personalInfo, setPersonalInfo] = useState({
    firstName: '',
    lastName: '',
    email: '',
    phone: '',
    dateOfBirth: '',
    gender: '',
    maritalStatus: '',
    address: {
      street: '',
      city: '',
      state: '',
      zipCode: '',
      country: ''
    }
  });
  const [age, setAge] = useState(null);
  const [isBirthday, setIsBirthday] = useState(false);

  const formatPhoneNumber = (value) => {
    // Remove all non-digits
    const phoneNumber = value.replace(/\D/g, '');
    
    // Format according to length
    if (phoneNumber.length <= 3) {
      return phoneNumber;
    } else if (phoneNumber.length <= 6) {
      return `(${phoneNumber.slice(0, 3)}) ${phoneNumber.slice(3)}`;
    } else if (phoneNumber.length <= 10) {
      return `(${phoneNumber.slice(0, 3)}) ${phoneNumber.slice(3, 6)}-${phoneNumber.slice(6)}`;
    } else {
      return `(${phoneNumber.slice(0, 3)}) ${phoneNumber.slice(3, 6)}-${phoneNumber.slice(6, 10)}`;
    }
  };

  const isValidPhoneNumber = (phone) => {
    const digitsOnly = phone.replace(/\D/g, '');
    return digitsOnly.length === 10;
  };

  const handlePhoneChange = (e) => {
    const formattedPhone = formatPhoneNumber(e.target.value);
    setPersonalInfo(prev => ({
      ...prev,
      phone: formattedPhone
    }));
    setIsUpdated(true);
  };

  const handlePostalCodeChange = (e) => {
    const value = e.target.value;
    const country = personalInfo.address.country || 'US';
    const formatted = formatPostalCode(value, country);
    
    handlePersonalInfoChange({
      target: {
        name: 'address.zipCode',
        value: formatted
      }
    });
  };

  console.log("user >>>", userData);
  useEffect(() => {
    const fetchUserData = async () => {
      if (user) {
        try {
          const userDoc = await getDoc(doc(db, "users", user.uid));
          if (userDoc.exists()) {
            const userData = userDoc.data();
            const fileRef = ref(storage, userData.profileImg);
            const downloadURL = await getDownloadURL(fileRef);
            setUserData({
              ...userData,
              profileImg: downloadURL,
            });
          }
        } catch (error) {
          console.error("Error fetching user data:", error);
        } finally {
          setLoading(false);
        }
      }
    };

    fetchUserData();
  }, [user, userData.churchId]);

  useEffect(() => {
    if (userData) {
      setPersonalInfo({
        firstName: userData.name || '',
        lastName: userData.lastName || '',
        email: userData.email || '',
        phone: userData.phone || '',
        dateOfBirth: userData.dateOfBirth || '',
        gender: userData.gender || '',
        maritalStatus: userData.maritalStatus || '',
        address: {
          street: userData.address?.street || '',
          city: userData.address?.city || '',
          state: userData.address?.state || '',
          zipCode: userData.address?.zipCode || '',
          country: userData.address?.country || ''
        }
      });
    }
  }, [userData]);

  useEffect(() => {
    if (personalInfo.dateOfBirth) {
      calculateAge(personalInfo.dateOfBirth);
    }
  }, [personalInfo.dateOfBirth]);

  const fetchGroups = async () => {
    try {
      const groupsData = await fetchGroupList(id);
      console.log("all groups >>", groupsData);

      // Filter groups where current user is a member
      const userGroups = groupsData.filter(
        (group) =>
          group.members &&
          group.members.some((member) => member.userId === user?.uid)
      );

      // Set all groups for the dropdown options
      setGroups(groupsData);

      // Set selected groups based on user membership
      const selectedOptions = userGroups.map((group) => ({
        value: group.id,
        label: group.groupName,
      }));
      setSelectedGroups(selectedOptions);
    } catch (error) {
      console.error("Error fetching groups:", error);
    }
  };

  useEffect(() => {
    fetchGroups();
  }, [id]);

  const calculateAge = (birthDate) => {
    if (!birthDate) return null;
    
    const today = new Date();
    const birth = new Date(birthDate);
    
    let age = today.getFullYear() - birth.getFullYear();
    const monthDiff = today.getMonth() - birth.getMonth();
    
    if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < birth.getDate())) {
      age--;
    }

    // Check if it's their birthday
    const isBirthday = today.getMonth() === birth.getMonth() && 
                       today.getDate() === birth.getDate();
    
    setAge(age);
    setIsBirthday(isBirthday);
  };

  const handleGroupChange = async (selectedOptions) => {
    try {
      setAddingGroup(true);
      // Remove duplicates
      const uniqueOptions = selectedOptions.filter(
        (option, index, self) =>
          index === self.findIndex((t) => t.value === option.value)
      );

      // Find groups that were removed and added
      const removedGroups = selectedGroups.filter(
        (group) => !uniqueOptions.some((option) => option.value === group.value)
      );
      const addedGroups = uniqueOptions.filter(
        (option) =>
          !selectedGroups.some((group) => group.value === option.value)
      );

      // Handle removed groups
      for (const removedGroup of removedGroups) {
        const groupRef = doc(db, "groups", removedGroup.value);
        const groupDoc = await getDoc(groupRef);

        if (groupDoc.exists()) {
          const groupData = groupDoc.data();
          const updatedMembers = groupData.members.filter(
            (member) => member.userId !== user?.uid
          );

          await updateDoc(groupRef, {
            members: updatedMembers,
          });
        }
      }

      // Handle added groups
      for (const addedGroup of addedGroups) {
        const groupRef = doc(db, "groups", addedGroup.value);
        const groupDoc = await getDoc(groupRef);

        if (groupDoc.exists()) {
          const groupData = groupDoc.data();
          const members = groupData.members || [];

          if (!members.some((member) => member.userId === user?.uid)) {
            const newMember = {
              userId: user?.uid,
              displayName: `${user.name} ${user.lastName}`,
              role: user.role,
            };

            await updateDoc(groupRef, {
              members: [...members, newMember],
            });
          }
        }
      }

      // Update user's groups in Firestore
      // await updateDoc(doc(db, "users", user?.uid), {
      //   groups: uniqueOptions.map(option => option.value)
      // });

      // Set the selected groups with proper value/label structure
      const formattedOptions = uniqueOptions.map((option) => ({
        value: option.value,
        label: option.label,
      }));

      console.log("selected groups >>", formattedOptions);
      setSelectedGroups(formattedOptions);

      if (removedGroups.length > 0) {
        toast.success("Removed your selected group");
      }
      if (addedGroups.length > 0) {
        toast.success("Added your selected group");
      }
    } catch (error) {
      console.error("Error updating group members:", error);
      toast.error("Error updating group membership");
    } finally {
      setAddingGroup(false);
    }
  };

  const handleProfessionChange = (selectedOptions) => {
    setUserData((prevData) => ({
      ...prevData,
      Profession: selectedOptions
        ? selectedOptions.map((option) => option.value)
        : [],
    }));
    setIsUpdated(true);
  };

  const handleNationalityChange = (selectedOptions) => {
    setUserData((prevData) => ({
      ...prevData,
      Nationality: selectedOptions
        ? selectedOptions.map((option) => option.value)
        : [],
    }));
    setIsUpdated(true);
  };

  const handleLanguageChange = (selectedOptions) => {
    setUserData((prevData) => ({
      ...prevData,
      language: selectedOptions
        ? selectedOptions.map((option) => option.value)
        : [],
    }));
    setIsUpdated(true);
  };

  const handleSkillChange = (selectedOptions) => {
    setUserData((prevData) => ({
      ...prevData,
      skill: selectedOptions
        ? selectedOptions.map((option) => option.value)
        : [],
    }));
    setIsUpdated(true);
  };

  const handleCreateOption = async (type, inputValue) => {
    const newValue = inputValue.trim();

    try {
      // Update user data with new option
      const updatedData = { ...userData };
      if (!updatedData[type]) {
        updatedData[type] = [];
      }
      updatedData[type].push(newValue);
      setUserData(updatedData);
      setIsUpdated(true);

      toast.success(`Added new ${type}: ${newValue}`);
    } catch (error) {
      console.error("Error adding new option:", error);
      toast.error("Failed to add new option");
    }
  };

  const handlePersonalInfoChange = (e) => {
    const { name, value } = e.target;
    if (name.startsWith('address.')) {
      const addressField = name.split('.')[1];
      setPersonalInfo(prev => ({
        ...prev,
        address: {
          ...prev.address,
          [addressField]: value
        }
      }));
    } else {
      setPersonalInfo(prev => ({
        ...prev,
        [name]: value
      }));
    }
    setIsUpdated(true);
  };

  const handleSave = async () => {
    if (user) {
      try {
        const updatedData = {
          ...userData,
          name: personalInfo.firstName,
          lastName: personalInfo.lastName,
          email: personalInfo.email,
          phone: personalInfo.phone,
          dateOfBirth: personalInfo.dateOfBirth,
          gender: personalInfo.gender,
          maritalStatus: personalInfo.maritalStatus,
          address: personalInfo.address
        };

        // Update the document
        const userRef = doc(db, "users", user.uid);
        await updateDoc(userRef, updatedData);

        // Refresh the user data by fetching it again
        const updatedDoc = await getDoc(userRef);
        if (updatedDoc.exists()) {
          const freshData = updatedDoc.data();
          // If there's a profile image, get its URL
          if (freshData.profileImg) {
            const fileRef = ref(storage, freshData.profileImg);
            const downloadURL = await getDownloadURL(fileRef);
            setUserData({
              ...freshData,
              profileImg: downloadURL,
            });
          } else {
            setUserData(freshData);
          }
        }

        toast.success("User data updated successfully");
        setIsUpdated(false);
      } catch (error) {
        console.error("Error updating user data:", error);
        toast.error("Error updating user data");
      }
    }
  };

  const handleProfileUpload = async (event) => {
    const file = event.target.files[0];
    if (!file || !user.uid) return;

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
    setPreviewProfile(fileURL);

    setUploadingProfile(true);
    try {
      const uniqueFileName = `${userData?.name}${
        userData?.lastName
      }-${Date.now()}-${file.name}`;
      const filePath = `/users/church_${id}/${uniqueFileName}`;
      const fileRef = ref(storage, filePath);

      // Delete previous file if exists
      const previousFileUrl = userData?.profileImg;
      if (previousFileUrl) {
        const previousFileRef = ref(storage, previousFileUrl);
        await deleteObject(previousFileRef).catch((error) => {
          console.warn("Error deleting old file:", error);
        });
      }

      //Add new file
      await uploadBytes(fileRef, file);
      const downloadURL = await getDownloadURL(fileRef);

      // Update church document
      const userRef = doc(db, "users", user.uid);
      await updateDoc(userRef, { profileImg: filePath });

      toast.success("Profile updated successfully!");
    } catch (error) {
      console.error("Error updating profile:", error);
      toast.error(`Failed to update profile`);
    }

    setUploadingProfile(false);
  };

  const handleHelpClick = () => {
    alert("Help button clicked!");
  };

  if (loading) {
    return <p>Loading...</p>;
  }

  return (
    <div style={{ ...commonStyles.container, textAlign: "left" }}>
      <div style={{ display: "flex", justifyContent: "space-between" }}>
        <button
          onClick={() => window.history.back()}
          style={commonStyles.backButton}
        >
          ⬅ Volver
        </button>
        <button onClick={handleHelpClick} style={commonStyles.backButton}>
          Help
        </button>
      </div>

      <ChurchHeader id={id} applyShadow={false} />

      <h2 className="sobre-heading">Sobre Mi</h2>

      {userData ? (
        <div>
          {/* Profile Summary Section - New section moved from MiPerfil */}
          <div className="profile-summary-section">
            <div className="profile-info-card">
              <div className="info-row">
                <label>Nombre:</label>
                <span>{userData.name} {userData.lastName}</span>
              </div>
              <div className="info-row">
                <label>Correo Electrónico:</label>
                <span>{userData.email}</span>
              </div>
              <div className="info-row">
                <label>Rol:</label>
                <span>{userData.role === 'global_admin' ? 'Global Admin' : 
                       userData.role === 'admin' ? 'Admin' : 
                       userData.role === 'leader' ? 'Leader' : 'Member'}</span>
              </div>
              <div className="info-row">
                <label>Grupos:</label>
                <div className="groups-list">
                  {selectedGroups.length > 0 ? (
                    selectedGroups.map((group, index) => (
                      <span key={index} className="group-tag">{group.label}</span>
                    ))
                  ) : (
                    <span className="no-groups">No groups joined</span>
                  )}
                </div>
              </div>
            </div>
          </div>

          <div className="profile-image-container">
            {loading || uploadingProfile ? (
              <Skeleton circle height={120} width={120} />
            ) : (
              <div className="profile-image-wrapper">
                <img
                  src={
                    previewProfile ||
                    userData?.profileImg ||
                    "/img/logo-fallback.svg"
                  }
                  alt="profile-pic"
                  className="profile-image"
                />
                <label className="edit-icon-label">
                  <FaEdit color="white" size={16} />
                  <input
                    type="file"
                    style={{ display: "none" }}
                    onChange={(e) => handleProfileUpload(e)}
                    accept=".png,.jpg,.jpeg"
                    disabled={uploadingProfile}
                  />
                </label>
              </div>
            )}
          </div>
          <div className="personal-info-section">
            <h3>Personal Information</h3>
            <div className="form-grid">
              <div className="form-group">
                <label>First Name:</label>
                <input
                  type="text"
                  name="firstName"
                  value={personalInfo.firstName}
                  onChange={handlePersonalInfoChange}
                  className="form-input"
                />
              </div>
              <div className="form-group">
                <label>Last Name:</label>
                <input
                  type="text"
                  name="lastName"
                  value={personalInfo.lastName}
                  onChange={handlePersonalInfoChange}
                  className="form-input"
                />
              </div>
              <div className="form-group">
                <label>Email:</label>
                <input
                  type="email"
                  name="email"
                  value={personalInfo.email}
                  onChange={handlePersonalInfoChange}
                  className="form-input"
                />
              </div>
              <div className="form-group">
                <label>Phone:</label>
                <input
                  type="tel"
                  name="phone"
                  value={personalInfo.phone}
                  onChange={handlePhoneChange}
                  className={`form-input ${personalInfo.phone && !isValidPhoneNumber(personalInfo.phone) ? 'invalid-phone' : ''}`}
                  placeholder="(123) 456-7890"
                />
                {personalInfo.phone && !isValidPhoneNumber(personalInfo.phone) && (
                  <span className="phone-error">Please enter a valid 10-digit phone number</span>
                )}
              </div>
              <div className="form-group">
                <label>Date of Birth:</label>
                <input
                  type="date"
                  name="dateOfBirth"
                  value={personalInfo.dateOfBirth}
                  onChange={handlePersonalInfoChange}
                  className="form-input"
                />
                {age !== null && (
                  <span className="age-display">
                    Age: {age} years
                    {isBirthday && (
                      <div className="birthday-message">
                        🎉 Happy Birthday! 🎂
                      </div>
                    )}
                  </span>
                )}
              </div>
              <div className="form-group">
                <label>Gender:</label>
                <select
                  name="gender"
                  value={personalInfo.gender}
                  onChange={handlePersonalInfoChange}
                  className="form-input"
                >
                  <option value="">Select gender</option>
                  <option value="male">Male</option>
                  <option value="female">Female</option>
                </select>
              </div>
              <div className="form-group">
                <label>Marital Status:</label>
                <select
                  name="maritalStatus"
                  value={personalInfo.maritalStatus}
                  onChange={handlePersonalInfoChange}
                  className="form-input"
                >
                  <option value="">Select status</option>
                  <option value="single">Single</option>
                  <option value="married">Married</option>
                  <option value="divorced">Divorced</option>
                  <option value="widowed">Widowed</option>
                </select>
              </div>
            </div>

            <h3>Address Information</h3>
            <div className="form-grid">
              <div className="form-group full-width">
                <label>Street Address:</label>
                <input
                  type="text"
                  name="address.street"
                  value={personalInfo.address.street}
                  onChange={handlePersonalInfoChange}
                  className="form-input"
                />
              </div>
              <div className="form-group">
                <label>City:</label>
                <input
                  type="text"
                  name="address.city"
                  value={personalInfo.address.city}
                  onChange={handlePersonalInfoChange}
                  className="form-input"
                />
              </div>
              <div className="form-group">
                <label>State:</label>
                <input
                  type="text"
                  name="address.state"
                  value={personalInfo.address.state}
                  onChange={handlePersonalInfoChange}
                  className="form-input"
                />
              </div>
              <div className="form-group">
                <label>Country:</label>
                <CreatableSelect
                  value={personalInfo.address.country ? 
                    { value: personalInfo.address.country, label: countries.find(c => c.value === personalInfo.address.country)?.label || personalInfo.address.country } : null}
                  options={countries}
                  onChange={(selected) => {
                    handlePersonalInfoChange({
                      target: {
                        name: 'address.country',
                        value: selected.value
                      }
                    });
                    // Reset postal code when country changes
                    handlePersonalInfoChange({
                      target: {
                        name: 'address.zipCode',
                        value: ''
                      }
                    });
                  }}
                  className="form-input"
                  placeholder="Select or type country"
                  formatCreateLabel={(inputValue) => `Use "${inputValue}"`}
                />
              </div>
              <div className="form-group">
                <label>Postal/ZIP Code:</label>
                <input
                  type="text"
                  name="address.zipCode"
                  value={personalInfo.address.zipCode}
                  onChange={handlePostalCodeChange}
                  className={`form-input ${
                    personalInfo.address.zipCode && 
                    !validatePostalCode(personalInfo.address.zipCode, personalInfo.address.country) 
                      ? 'invalid-input' 
                      : ''
                  }`}
                  placeholder={personalInfo.address.country === 'CA' ? 'A1A 1A1' : '12345'}
                />
                {personalInfo.address.zipCode && 
                 !validatePostalCode(personalInfo.address.zipCode, personalInfo.address.country) && (
                  <span className="error-text">Invalid postal code format</span>
                )}
              </div>
            </div>
          </div>
          <div className="sobre-select">
            <label>Nationality:</label>
            <Select
              isMulti
              isSearchable
              name="Nationality"
              value={
                Array.isArray(userData.Nationality)
                  ? userData.Nationality.map((nationality) => ({
                      value: nationality,
                      label: nationality,
                    }))
                  : []
              }
              options={nacionalidades.map((nationality) => ({
                value: nationality,
                label: nationality,
              }))}
              onChange={handleNationalityChange}
            />
          </div>
          <div className="sobre-select">
            <label>Profession:</label>
            <CreatableSelect
              isMulti
              isSearchable
              name="Profession"
              value={
                Array.isArray(userData.Profession)
                  ? userData.Profession.map((profession) => ({
                      value: profession,
                      label: profession,
                    }))
                  : []
              }
              options={ocupaciones.map((profession) => ({
                value: profession,
                label: profession,
              }))}
              onChange={handleProfessionChange}
              onCreateOption={(inputValue) =>
                handleCreateOption("Profession", inputValue)
              }
              placeholder="Select or create professions..."
            />
          </div>
          <div className="sobre-select">
            <label>Groups:</label>
            {addingGroup ? (
              <div className="loading-group-adding">
                <Spinner animation="border" variant="primary" size="sm" />
                <p className="loading-text">Updating groups...</p>
              </div>
            ) : (
              <AsyncCreatableSelect
                isMulti
                cacheOptions
                defaultOptions={groups.map((group) => ({
                  value: group.id,
                  label: group.groupName,
                }))}
                loadOptions={(inputValue) => {
                  const filteredGroups = groups.filter((group) =>
                    group.groupName
                      .toLowerCase()
                      .includes(inputValue.toLowerCase())
                  );
                  return filteredGroups.map((group) => ({
                    value: group.id,
                    label: group.groupName,
                  }));
                }}
                value={selectedGroups}
                onChange={handleGroupChange}
                placeholder="Selecciona los grupos"
              />
            )}
          </div>
          <div className="sobre-select">
            <label>Language:</label>
            <CreatableSelect
              isMulti
              isSearchable
              name="language"
              value={
                Array.isArray(userData.language)
                  ? userData.language.map((language) => ({
                      value: language,
                      label: language,
                    }))
                  : []
              }
              options={idiomas.map((language) => ({
                value: language,
                label: language,
              }))}
              onChange={handleLanguageChange}
              onCreateOption={(inputValue) =>
                handleCreateOption("language", inputValue)
              }
              placeholder="Select or create languages..."
            />
          </div>
          <div className="sobre-select">
            <label>Skill:</label>
            <CreatableSelect
              isMulti
              isSearchable
              name="skill"
              value={
                Array.isArray(userData.skill)
                  ? userData.skill.map((skill) => ({
                      value: skill,
                      label: skill,
                    }))
                  : []
              }
              options={Object.values(habilidades)
                .flat()
                .map((skill) => ({ value: skill, label: skill }))}
              onChange={handleSkillChange}
              onCreateOption={(inputValue) =>
                handleCreateOption("skill", inputValue)
              }
              placeholder="Select or create skills..."
            />
          </div>
          <button
            onClick={handleSave}
            disabled={!isUpdated}
            className={`sobre-save-button ${isUpdated ? "active" : ""}`}
          >
            Save
          </button>
        </div>
      ) : (
        <p>No user data available</p>
      )}
    </div>
  );
};

export default Sobre;
