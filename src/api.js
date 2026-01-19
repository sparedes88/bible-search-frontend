import axios from 'axios'; // ✅ Ensure axios is imported

const API_BASE_URL = "https://iglesia-tech-api.e2api.com";

// ✅ Fetch Full Church Details by ID
export const searchChurchById = async (idIglesia) => {
  try {
    console.log(`Fetching full church details for ID: ${idIglesia}`);

    const response = await axios.get(`${API_BASE_URL}/api/iglesiaTechApp/iglesias/getIglesiaProfileDetail`, {
      params: { idIglesia }
    });

    console.log("Church API Response:", response.data);
    return response.data.iglesia || null;
  } catch (error) {
    console.error("❌ Failed to fetch church details:", error);
    return null;
  }
};

// ✅ Fetch Public Groups by Church ID (`idIglesia`)
export const getPublicChurchGroups = async (idIglesia) => {
  try {
    console.log(`Fetching public groups for church ID: ${idIglesia}`);

    const response = await axios.get(`${API_BASE_URL}/api/iglesiaTechApp/groups/filter`, {
      params: {
        idIglesia,
        type: "public",
        group_type: 1, // Ministries
      },
    });

    console.log("Groups API Response:", response.data.groups || []);
    return Array.isArray(response.data.groups) ? response.data.groups : [];
  } catch (error) {
    console.error("❌ Failed to fetch groups:", error);
    return [];
  }
};

// ✅ Fetch Church Events Using the Correct API
export const getChurchEvents = async (idIglesia) => {
  try {
    console.log(`Fetching events for church ID: ${idIglesia}`);

    const response = await axios.get(`${API_BASE_URL}/api/iglesiaTechApp/groups/getEventsByView`, {
      params: { idIglesia },
    });

    if (!response.data || !Array.isArray(response.data.events)) {
      console.error("❌ Events API response is invalid:", response.data);
      return [];
    }

    const allEvents = response.data.events;

    // ✅ Extract only the required fields and filter upcoming events
    const today = new Date();
    const upcomingEvents = allEvents
      .filter(event => event.start_date && new Date(event.start_date) >= today)
      .map(event => ({
        idGroupEvent: event.idGroupEvent,
        name: event.name,
        description: event.description,
        start_date: event.start_date,
        end_date: event.end_date,
        picture: event.picture,
        ticket_cost: event.ticket_cost,
        publish_status: event.publish_status,
        timezone: event.timezone,
      }))
      .sort((a, b) => new Date(a.start_date) - new Date(b.start_date));

    console.log("Filtered Events API Response:", upcomingEvents);
    return upcomingEvents;
  } catch (error) {
    console.error("❌ Failed to fetch events:", error);
    return [];
  }
};

// ✅ Fetch User Profile by Church ID
export const getUserProfile = async (idIglesia) => {
  try {
    console.log(`Fetching user profile for church ID: ${idIglesia}`);

    const response = await axios.get(`${API_BASE_URL}/api/iglesiaTechApp/user/getUserProfile`, {
      params: { idIglesia }
    });

    console.log("User Profile API Response:", response.data);
    return response.data.user || null;
  } catch (error) {
    console.error("❌ Failed to fetch user profile:", error);
    return null;
  }
};