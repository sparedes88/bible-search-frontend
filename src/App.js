import React, { useEffect } from "react";
import {
  BrowserRouter as Router,
  Route,
  Routes,
  Navigate,
} from "react-router-dom";
import { auth, onMessageListener, requestForToken } from "./firebase"; // Import Firebase Auth
import { useAuthState } from "react-firebase-hooks/auth";
import ChurchInfo from "./pages/ChurchInfo";
import MiPerfil from "./components/MiPerfil"; // Ensure this import is correct
import ProfilePage from "./components/ProfilePage";
import Search from "./components/Search"; // Import the Search component
import EventsPage from "./pages/EventsPage";
import GroupsPage from "./pages/GroupsPage";
import DirectoryPage from "./pages/DirectoryPage";
import ContactPage from "./pages/ContactPage";
import ArticlesPage from "./pages/ArticlesPage";
import MediaPage from "./components/MediaPage"; // Updated import path
import MediaDetailPage from "./components/MediaDetailPage"; // Import MediaDetailPage
import GalleryPage from "./pages/GalleryPage";
import BiblePage from "./pages/BiblePage";
import LetterGeneratorPage from "./components/ChurchLetterGenerator";
import Login from "./components/Login"; // Ensure the path is correct
import Register from "./components/Register";
import ProtectedRoute from "./components/ProtectedRoute"; // Protect Only `/mi-perfil`
import RequireAuth from "./components/RequireAuth"; // Add this import
import Chat from "./components/Chat"; // Import Chat component
import GroupList from "./components/GroupList"; // Import GroupList component
import Admin from "./components/Admin"; // Import Admin component
import { AuthProvider } from "./contexts/AuthContext"; // Import AuthProvider
import ArticlePageDetail from "./pages/ArticleDetailPage"; // Import ArticlePageDetail component
import VideoPage from "./pages/VideoPage"; // Import VideoPage component
import AudioPage from "./pages/AudioPage"; // Import the AudioPage component
import PDFPage from "./pages/PDFPage"; // Import the PDFPage component
import ChatV2 from "./components/ChatV2"; // Import the ChatV2 component
import ChatLog from "./components/ChatLog"; // Import the ChatLog component
import MediaAdmin from "./components/mediaadmin"; // Ensure the correct import
import Sobre from "./components/Sobre"; // Import the Sobre component
import Familia from "./components/Familia"; // Import the Familia component
import GalleryAdmin from "./components/galleryadmin"; // Import GalleryAdmin component
import GalleryView from "./components/galleryview"; // Import GalleryView component
import GalleryUpload from "./components/galleryupload"; // Import GalleryUpload component
import GalleryImages from "./components/GalleryImages"; // Import GalleryImages component
import Courses from "./components/Courses"; // Import Courses component
import CourseDetail from "./components/CourseDetail";
import CourseAdmin from "./components/CourseAdmin"; // Import CourseAdmin component
import CourseCategories from "./components/CourseCategories"; // Import CourseCategories component
import CourseManager from "./components/CourseManager"; // Import CourseManager component
import Process from "./components/Process"; // Import Process component
import FindUsersTest from "./components/FindUsersTest"; // Temporary debug component
import UserPermissionsAdmin from "./components/UserPermissionsAdmin"; // Import UserPermissionsAdmin component
import UsersDropdown from "./components/UsersDropdown"; // Import UsersDropdown component
import ErrorBoundary from "./components/ErrorBoundary"; // Import ErrorBoundary component
import ProcessConfigPage from "./pages/ProcessConfigPage"; // Add this import
import PrivateRoute from "./components/PrivateRoute"; // Import PrivateRoute component
import AdminConnect from "./components/AdminConnect"; // Import AdminConnect component
import SubcategorySettings from "./components/SubcategorySettings"; // Import SubcategorySettings component
import MiOrganizacion from "./components/MiOrganizacion"; // Import MiOrganizacion component
import AllEvents from "./components/AllEvents"; // Import AllEvents component
import ChurchApp from "./components/ChurchApp"; // Update this import path
import "bootstrap/dist/css/bootstrap.min.css";
import { ToastContainer } from "react-toastify";
import "react-toastify/dist/ReactToastify.css";
import EventDetails from "./components/EventDetails";
import VisitorDetails from "./components/VisitorDetails";
import EventCoordination from "./components/EventCoordination";
import ManageGroups from "./components/ManageGroups";
import AsistentePastoral from "./components/AsistentePastoral";
import EasyProjector from "./components/EasyProjector"; // Import EasyProjector component
import BroadcastView from "./components/BroadcastView";
import BroadcastView3 from './components/BroadcastView3';
import MemberProfile from './components/MemberProfile';
import MemberMessaging from './components/MemberMessaging'; // Import MemberMessaging component
import MemberDashboard from './components/MemberDashboard'; // Import MemberDashboard component
import VisitorMessages from './components/VisitorMessages'; // Import VisitorMessages component
import {
  RoomsPage,
  InventoryPage,
  FinancesPage,
  TeamsPage,
  MaintenancePage
} from './pages/ChurchSubPages';
import ChurchRooms from "./pages/church/Rooms";
import ChurchInventory from "./pages/church/Inventory";
import ChurchFinances from "./pages/church/Finances";
import ChurchTeams from "./pages/church/Teams";
import ChurchMaintenance from "./pages/church/Maintenance";
import Rooms from './pages/church/Rooms';
import Inventory from './pages/church/Inventory';
import Finances from './pages/church/Finances';
import Teams from './pages/church/Teams';
import Maintenance from './pages/church/Maintenance';
import CreateTeamPage from './pages/ChurchSubPages/CreateTeamPage'; // Update import path
import TeamDetailPage from './pages/ChurchSubPages/TeamDetailPage';
import EventRegistration from "./components/EventRegistration";
import EventRegistrationAdmin from "./components/EventRegistrationAdmin"; // Import EventRegistrationAdmin component
import BuildMyChurch from './components/BuildMyChurch';
import Messages from './components/Messages';
import BalanceManager from "./components/BalanceManager"; // Import BalanceManager component
import SongManager from "./components/SongManager"; // Import SongManager component
import InventoryItemDetail from "./components/InventoryItemDetail"; // Import InventoryItemDetail component
import MessageLogView from "./components/MessageLogView"; // Import MessageLogView component
import CourseAnalytics from "./components/CourseAnalytics"; // Import CourseAnalytics component
import BIDashboard from "./components/BIDashboard"; // Import BIDashboard component
import UserBIDashboard from "./components/UserBIDashboard"; // Import UserBIDashboard component
import MyPlan from "./components/MyPlan"; // Import MyPlan component
import ProductManager from "./components/ProductManager"; // Import ProductManager component
import InvoiceManager from "./components/InvoiceManager"; // Add this import
import SocialMedia from "./components/SocialMedia"; // Import SocialMedia component
import SocialMediaAccounts from "./components/SocialMediaAccounts"; // Import SocialMediaAccounts component
import LeicaModule from "./components/LeicaModule";
import RoleManager from "./components/RoleManager"; // Import RoleManager component
import UserRoleAssignment from "./components/UserRoleAssignment"; // Import UserRoleAssignment component
import Forms from "./components/Forms"; // Import Forms component
import FormViewer from "./components/FormViewer"; // Import FormViewer component
import FormEmbed from "./components/FormEmbed"; // Import FormEmbed component
import TimeTracker from "./components/TimeTracker"; // Import TimeTracker component
import GlobalChurchManager from "./components/GlobalChurchManager";
import ChurchProfile from "./components/ChurchProfile";
import FreshBooksCallback from "./components/FreshBooksCallback";
import SqlServerBridge from "./components/SqlServerBridge";

const App = () => {
  const [user] = useAuthState(auth);
  const userRole = user ? "global_admin" : "user"; // Example role assignment

  useEffect(() => {
    // Request notification permission and store token
    requestForToken();

    let unsubscribe;
    // Listen for foreground notifications
    const setupMessageListener = async () => {
      try {
        // Keep listening for messages
        const handleNewMessage = async () => {
          try {
            const payload = await onMessageListener();
            console.log("New notification received:", payload);

            // Only show notification if app is in foreground and visible
            if (Notification.permission === "granted" && document.visibilityState === "visible") {
              // Check if we're already on the chat route
              const currentPath = window.location.pathname;
              const targetPath = payload.data?.clickAction;

              // Skip notification if we're already on the target chat page
              if (currentPath === targetPath) {
                console.log("Skipping notification - user already on chat page");
                return;
              }

              // Show notification using service worker
              if ('serviceWorker' in navigator && navigator.serviceWorker.ready) {
                const registration = await navigator.serviceWorker.ready;
                await registration.showNotification(payload.notification.title, {
                  body: payload.notification.body,
                  icon: "/logo.png",
                  badge: "/logo.png",
                  data: payload.data,
                  tag: payload.data?.messageId || "chat-notification",
                  actions: [
                    {
                      action: "view",
                      title: "View Message",
                    },
                  ],
                });
              } else {
                // Fallback to basic notification if service worker is not available
                new Notification(payload.notification.title, {
                  body: payload.notification.body,
                  icon: "/logo.png",
                  badge: "/logo.png",
                  data: payload.data,
                  tag: payload.data?.messageId || "chat-notification",
                });
              }
            }
            // Continue listening for next message
            handleNewMessage();
          } catch (error) {
            console.error("Error handling message:", error);
            setTimeout(handleNewMessage, 1000);
          }
        };

        // Start listening
        handleNewMessage();
      } catch (error) {
        console.error("Error setting up message listener:", error);
      }
    };

    // Start the message listener
    setupMessageListener();

    // Initialize service worker
    if ("serviceWorker" in navigator) {
      navigator.serviceWorker
        .register("/firebase-messaging-sw.js")
        .then((registration) => {
          console.log("Service Worker registered successfully:", registration);
        })
        .catch((err) => {
          console.error("Service Worker registration failed:", err);
        });
    }

    // Cleanup on unmount
    return () => {
      if (unsubscribe) {
        unsubscribe();
      }
    };
  }, []);

  // Initialize service worker on component mount
  useEffect(() => {
    if ("serviceWorker" in navigator) {
      navigator.serviceWorker
        .register("/firebase-messaging-sw.js")
        .then((registration) => {
          console.log(
            "Service Worker registered successfully:",
            registration.scope
          );
        })
        .catch((err) => {
          console.error("Service Worker registration failed:", err);
        });
    }
  }, []);

  return (
    <AuthProvider>
      <Router>
        <Routes>
          <Route path="/" element={<Search />} />{" "}
          {/* Set Search as the main page */}
          <Route path="/church/:id" element={<ChurchApp />} />
          <Route path="/church/:id/info" element={<ChurchInfo />} />
          <Route path="/church/:id/mi-perfil" element={<MiPerfil />} />
          <Route path="/church/:id/profile" element={<ProfilePage />} />
          <Route path="/church/:id/search" element={<Search />} />
          <Route path="/church/:id/events" element={<EventsPage />} />
          <Route path="/church/:id/groups" element={<GroupsPage />} />
          <Route path="/church/:id/directory" element={<DirectoryPage />} />
          <Route path="/church/:id/contact" element={<ContactPage />} />
          <Route path="/church/:id/articles" element={<ArticlesPage />} />
          <Route
            path="/church/:id/articles/:articleId"
            element={<ArticlePageDetail />}
          />
          <Route path="/church/:id/media" element={<MediaPage />} />{" "}
          {/* Updated route */}
          <Route
            path="/church/:id/media/:playlistId"
            element={<MediaDetailPage />}
          />{" "}
          {/* New route */}
          <Route path="/church/:id/media/video" element={<VideoPage />} />
          <Route path="/church/:id/media/audio" element={<AudioPage />} />
          <Route path="/church/:id/media/pdf" element={<PDFPage />} />
          <Route path="/church/:id/gallery" element={<GalleryPage />} />
          <Route path="/church/:id/bible" element={<BiblePage />} />
          <Route
            path="/church/:id/letter-generator"
            element={<LetterGeneratorPage />}
          />
          <Route path="/church/:id/login" element={<Login />} />
          <Route path="/church/:id/register" element={<Register />} />
          <Route
            path="/group-list"
            element={
              user ? <GroupList /> : <Navigate to="/church/:id/login" />
            }
          />
          <Route
            path="/chat/:groupId"
            element={user ? <Chat /> : <Navigate to="/church/:id/login" />}
          />
          <Route
            path="/admin/:id"
            element={user ? <Admin /> : <Navigate to="/church/:id/login" />}
          />
          <Route path="/church/:id/chatv2" element={<ChatV2 />} />
          <Route
            path="/church/:id/chat/:groupId"
            element={<ChatLog />}
          />{" "}
          {/* Add the route for ChatLog */}
          <Route
            path="/church/:id/manage-groups"
            element={<ManageGroups />}
          />
          <Route path="/mediaadmin/:id" element={<MediaAdmin />} />
          <Route path="/church/:id/sobre" element={<Sobre />} />{" "}
          {/* Add the route for Sobre */}
          <Route path="/church/:id/family" element={<Familia />} />{" "}
          {/* Add the route for Familia */}
          <Route
            path="/church/:id/gallery-admin"
            element={<GalleryAdmin />}
          />
          <Route
            path="/church/:id/gallery-upload"
            element={<GalleryUpload />}
          />
          <Route path="/church/:id/gallery-view" element={<GalleryView />} />
          <Route
            path="/church/:id/gallery-images/:galleryId"
            element={<GalleryImages />}
          />
          <Route path="/church/:id/courses" element={<Courses />} />{" "}
          {/* Add the route for Courses */}
          <Route
            path="/church/:id/courses/:courseId"
            element={<CourseDetail />}
          />{" "}
          {/* Add the route for CourseDetail */}
          <Route
            path="/church/:id/course-admin"
            element={<CourseAdmin />}
          />{" "}
          {/* Add the route for CourseAdmin */}
          <Route
            path="/church/:id/user-permissions"
            element={<UserPermissionsAdmin />}
          />
          <Route
            path="/church/:id/find-users-test"
            element={<FindUsersTest />}
          />
          <Route
            path="/church/:id/course-categories"
            element={<CourseCategories />}
          />{" "}
          {/* Add the route for CourseCategories */}
          <Route
            path="/church/:id/course-manager"
            element={
              <ErrorBoundary>
                <CourseManager />
              </ErrorBoundary>
            }
          />{" "}
          {/* Add the route for CourseManager */}
          <Route path="/church/:id/process" element={<Process />} />{" "}
          {/* Add the route for Process */}
          <Route
            path="/church/:idIglesia/users"
            element={<UsersDropdown />}
          />{" "}
          {/* Add the route for UsersDropdown */}
          <Route
            path="/church/:id/course/:categoryId/subcategory/:subcategoryId"
            element={<CourseDetail />}
          />{" "}
          {/* Add the route for CourseDetail with subcategory */}
          {/* Add the route for direct category access */}
          <Route
            path="/church/:id/course/:categoryId"
            element={<CourseDetail />}
          />
          {/* Add route for /churchDetail pattern */}
          <Route
            path="/church/:id/courseDetail/:categoryId"
            element={<CourseDetail />}
          />
          <Route
            path="/church/:id/process-config"
            element={
              <ProtectedRoute requireGlobalAdmin={true}>
                <ProcessConfigPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/church/:id/admin-connect"
            element={
              <PrivateRoute roles={["admin", "global_admin"]}>
                <AdminConnect />
              </PrivateRoute>
            }
          />
          <Route
            path="/church/:id/admin-connect/:visitorId"
            element={
              <PrivateRoute roles={["admin", "global_admin"]}>
                <VisitorDetails />
              </PrivateRoute>
            }
          />
          <Route
            path="/church/:churchId/course/:categoryId/subcategory/:subcategoryId/settings"
            element={<SubcategorySettings />}
          />
          <Route
            path="/church/:id/mi-organizacion"
            element={<MiOrganizacion />}
          />
          <Route
            path="/church/:id/role-manager"
            element={
              <PrivateRoute roles={["admin", "global_admin"]}>
                <RoleManager />
              </PrivateRoute>
            }
          />
          <Route
            path="/church/:id/user-role-assignment"
            element={
              <PrivateRoute roles={["admin", "global_admin"]}>
                <UserRoleAssignment />
              </PrivateRoute>
            }
          />
          <Route path="/church/:id/all-events" element={<AllEvents />} />
          <Route
            path="/church/:id/event/:eventId"
            element={<EventDetails />}
          />
          <Route path="/church/:id/church-app" element={<ChurchApp />} />
          <Route
            path="/church/:id/event/:eventId/coordination"
            element={<EventCoordination />}
          />
          <Route
            path="/church/:id/asistente-pastoral"
            element={
              <PrivateRoute>
                <AsistentePastoral />
              </PrivateRoute>
            }
          />
          <Route
            path="/church/:id/easy-projector"
            element={
              <PrivateRoute>
                <EasyProjector />
              </PrivateRoute>
            }
          />
          <Route
            path="/church/:id/broadcast/:broadcastId"
            element={<BroadcastView />}
          />
          <Route
            path="/church/:id/broadcast3/:broadcastId"
            element={<BroadcastView3 />}
          />
          <Route
            path="/church/:id/broadcast3/:broadcastId/control"
            element={
              <PrivateRoute>
                <BroadcastView3 isControl={true} />
              </PrivateRoute>
            }
          />
          <Route
            path="/church/:id/member/:profileId"
            element={<MemberProfile />}
          />
          <Route 
            path="/church/:id/member/:profileId/dashboard" 
            element={<MemberDashboard />}
          />
          <Route path="/church/:id/member/:profileId/messages" element={<MemberMessaging />} /> {/* Add the route for MemberMessaging */}
          {/* Add Visitor Messaging route */}
          <Route path="/church/:id/visitor/:visitorId/messages" element={<VisitorMessages />} />
          <Route path="/church/:id/rooms" element={<RoomsPage />} />
          <Route path="/church/:id/inventory" element={<InventoryPage />} />
          <Route path="/church/:id/inventory/:itemId" element={<InventoryItemDetail />} />
          <Route path="/church/:id/finances" element={<FinancesPage />} />
          <Route path="/church/:id/teams" element={<TeamsPage />} />
          <Route path="/church/:id/teams/create" element={<CreateTeamPage />} />
          <Route path="/church/:id/maintenance" element={<MaintenancePage />} />
          <Route path="/church/:id/rooms" element={<ChurchRooms />} />
          <Route path="/church/:id/inventory" element={<ChurchInventory />} />
          <Route path="/church/:id/finances" element={<ChurchFinances />} />
          <Route 
            path="/church/:id/balance-manager" 
            element={
              <PrivateRoute roles={["admin", "global_admin"]}>
                <BalanceManager />
              </PrivateRoute>
            } 
          />
          <Route 
            path="/church/:id/balance" 
            element={
              <PrivateRoute roles={["admin", "global_admin"]}>
                <BalanceManager />
              </PrivateRoute>
            } 
          />
          <Route path="/church/:id/teams" element={<ChurchTeams />} />
          <Route path="/church/:id/maintenance" element={<ChurchMaintenance />} />
          <Route path="/church/:id/rooms" element={<Rooms />} />
          <Route path="/church/:id/inventory" element={<Inventory />} />
          <Route path="/church/:id/finances" element={<Finances />} />
          <Route path="/church/:id/teams" element={<Teams />} />
          <Route path="/church/:id/maintenance" element={<Maintenance />} />
          <Route path="/church/:id/teams/:teamId" element={<TeamDetailPage />} />
          <Route path="/church/:id/event/:eventId/register" element={<EventRegistration />} />
          <Route 
            path="/church/:id/event/:eventId/registrations" 
            element={
              <PrivateRoute roles={["admin", "global_admin"]}>
                <EventRegistrationAdmin />
              </PrivateRoute>
            } 
          />
          <Route 
            path="/church/:id/event/:eventId/manage-registrations" 
            element={
              <PrivateRoute roles={["admin", "global_admin"]}>
                <EventRegistrationAdmin />
              </PrivateRoute>
            } 
          />
          <Route
            path="/church/:id/user-dashboard"
            element={
              <PrivateRoute>
                <UserBIDashboard />
              </PrivateRoute>
            }
          />
          <Route
            path="/church/:id/build-my-church"
            element={
              <PrivateRoute>
                <BuildMyChurch />
              </PrivateRoute>
            }
          />
          <Route path="/church/:id/messages" element={
            <RequireAuth>
              <Messages />
            </RequireAuth>
          } />
          <Route
            path="/church/:id/song-manager"
            element={
              <PrivateRoute roles={["admin", "global_admin"]}>
                <SongManager />
              </PrivateRoute>
            }
          />
          
          {/* Message Log Routes */}
          <Route 
            path="/church/:id/message-log/:type/:entityId" 
            element={
              <PrivateRoute roles={["admin", "global_admin"]}>
                <MessageLogView />
              </PrivateRoute>
            } 
          />
          
          {/* Visitor Message Log Shortcut */}
          <Route 
            path="/church/:id/visitor-log/:visitorId" 
            element={
              <Navigate to={params => `/church/${params.id}/message-log/visitor/${params.visitorId}`} replace />
            } 
          />
          
          {/* Member Message Log Shortcut */}
          <Route 
            path="/church/:id/member-log/:memberId" 
            element={
              <Navigate to={params => `/church/${params.id}/message-log/member/${params.memberId}`} replace />
            } 
          />
          
          {/* Course Analytics Route */}
          <Route
            path="/church/:id/course-analytics"
            element={
              <PrivateRoute roles={["admin", "global_admin"]}>
                <CourseAnalytics />
              </PrivateRoute>
            }
          />
          
          {/* Business Intelligence Dashboard Route */}
          <Route
            path="/church/:id/bi-dashboard"
            element={
              <PrivateRoute roles={["admin", "global_admin"]}>
                <BIDashboard />
              </PrivateRoute>
            }
          />
          
          {/* My Plan Route */}
          <Route
            path="/church/:id/my-plan"
            element={
              <PrivateRoute roles={["admin", "global_admin"]}>
                <MyPlan />
              </PrivateRoute>
            }
          />
          
          {/* Product Manager Routes */}
          <Route
            path="/church/:id/product-manager"
            element={
              <PrivateRoute roles={["admin", "global_admin"]}>
                <ProductManager />
              </PrivateRoute>
            }
          />
          
          <Route
            path="/product-manager/:productId"
            element={
              <PrivateRoute roles={["admin", "global_admin"]}>
                <ProductManager />
              </PrivateRoute>
            }
          />

          {/* InvoiceManager Route */}
          <Route 
            path="/church/:id/invoices" 
            element={
              <PrivateRoute roles={["admin", "global_admin"]}>
                <InvoiceManager />
              </PrivateRoute>
            } 
          />
          
          {/* SocialMedia Route */}
          <Route 
            path="/church/:id/social-media" 
            element={
              <PrivateRoute roles={["admin", "global_admin"]}>
                <SocialMedia />
              </PrivateRoute>
            } 
          />
          
          {/* SocialMediaAccounts Route */}
          <Route 
            path="/church/:id/social-media-accounts" 
            element={
              <PrivateRoute roles={["admin", "global_admin"]}>
                <SocialMediaAccounts />
              </PrivateRoute>
            } 
          />
          
          {/* Forms Route */}
          <Route 
            path="/church/:id/forms" 
            element={
              <PrivateRoute roles={["admin", "global_admin", "member"]}>
                <Forms />
              </PrivateRoute>
            } 
          />
          
          {/* Time Tracker Route */}
          <Route 
            path="/church/:id/time-tracker" 
            element={
              <PrivateRoute>
                <TimeTracker />
              </PrivateRoute>
            } 
          />
          
          {/* Public Form Viewer Route */}
          <Route 
            path="/church/:id/form/:formId" 
            element={<FormViewer />}
          />
          
          {/* Embeddable Form Route */}
          <Route 
            path="/church/:id/embed/:formId" 
            element={<FormEmbed />}
          />
          
          <Route path="/church/:id/leica" element={<LeicaModule />} />
          <Route path="/global-church-manager" element={<GlobalChurchManager />} />
          <Route path="/church-profile/:id" element={<ChurchProfile />} />
          <Route 
            path="/sql-server-bridge" 
            element={
              <PrivateRoute roles={["admin", "global_admin"]}>
                <SqlServerBridge />
              </PrivateRoute>
            } 
          />
          <Route path="/freshbooks/callback" element={<FreshBooksCallback />} />
        </Routes>
      </Router>
      <ToastContainer />
    </AuthProvider>
  );
};

export default App;
