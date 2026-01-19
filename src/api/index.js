import axios from 'axios';

const API_BASE_URL = "https://iglesia-tech-api.e2api.com";

export const getPublicChurchGroups = async (churchID) => {
  try {
    const response = await axios.get(`${API_BASE_URL}/api/iglesiaTechApp/groups/getPublicGroups`, {
      params: { churchID }
    });
    return response.data.groups.filter(group => group.isPublic && group.isActive);
  } catch (error) {
    console.error("Error fetching public church groups:", error);
    return [];
  }
};