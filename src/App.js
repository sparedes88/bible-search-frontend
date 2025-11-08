import React, { useEffect } from "react";
import {
  BrowserRouter as Router,
  Route,
  Routes,
  Navigate,
} from "react-router-dom";
import { auth } from "./firebase"; // Import Firebase Auth
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
import AddVisitor from "./components/AddVisitor"; // Import AddVisitor component
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
import GroupDetails from "./components/GroupDetails";
import AsistentePastoral from "./components/AsistentePastoral";
import EasyProjector from "./components/EasyProjector"; // Import EasyProjector component
import BroadcastView from "./components/BroadcastView";
import BroadcastView3 from './components/BroadcastView3';
import MemberProfile from './components/MemberProfile';
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
import MemberSignup from "./components/MemberSignup.clean";
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
import FormEntriesPage from "./components/FormEntriesPage"; // Import FormEntriesPage component
import TimeTracker from "./components/TimeTracker"; // Import TimeTracker component
import TimerPage from "./components/TimerPage"; // Import TimerPage component
import GlobalOrganizationManager from "./components/GlobalOrganizationManager";
import ChurchProfile from "./components/ChurchProfile";
import FreshBooksCallback from "./components/FreshBooksCallback";
import SqlServerBridge from "./components/SqlServerBridge";

const App = () => {
  const [user] = useAuthState(auth);
  const userRole = user ? "global_admin" : "user"; // Example role assignment

  return (
    <AuthProvider>
      <Router>
        <Routes>
          <Route path="/" element={<Search />} />{" "}
          {/* Set Search as the main page */}
          <Route path="/organization/:id" element={<ChurchApp />} />
          <Route path="/organization/:id/info" element={<ChurchInfo />} />
          <Route path="/organization/:id/mi-perfil" element={<MiPerfil />} />
          <Route path="/organization/:id/profile" element={<ProfilePage />} />
          <Route path="/organization/:id/search" element={<Search />} />
          <Route path="/organization/:id/events" element={<EventsPage />} />
          <Route path="/organization/:id/groups" element={<GroupsPage />} />
          <Route path="/organization/:id/directory" element={<DirectoryPage />} />
          <Route path="/organization/:id/contact" element={<ContactPage />} />
          <Route path="/organization/:id/articles" element={<ArticlesPage />} />
          <Route
            path="/organization/:id/articles/:articleId"
            element={<ArticlePageDetail />}
          />
          <Route path="/organization/:id/media" element={<MediaPage />} />{" "}
          {/* Updated route */}
          <Route
            path="/organization/:id/media/:playlistId"
            element={<MediaDetailPage />}
          />{" "}
          {/* New route */}
          <Route path="/organization/:id/media/video" element={<VideoPage />} />
          <Route path="/organization/:id/media/audio" element={<AudioPage />} />
          <Route path="/organization/:id/media/pdf" element={<PDFPage />} />
          <Route path="/organization/:id/gallery" element={<GalleryPage />} />
          <Route path="/organization/:id/bible" element={<BiblePage />} />
          <Route
            path="/organization/:id/letter-generator"
            element={<LetterGeneratorPage />}
          />
          <Route path="/organization/:id/login" element={<Login />} />
          <Route path="/organization/:id/register" element={<Register />} />
          <Route
            path="/group-list"
            element={
              user ? <GroupList /> : <Navigate to="/organization/:id/login" />
            }
          />
          <Route
            path="/chat/:groupId"
            element={user ? <Chat /> : <Navigate to="/organization/:id/login" />}
          />
          <Route
            path="/admin/:id"
            element={user ? <Admin /> : <Navigate to="/organization/:id/login" />}
          />
          <Route path="/organization/:id/chatv2" element={<ChatV2 />} />
          <Route
            path="/organization/:id/chat/:groupId"
            element={<ChatLog />}
          />{" "}
          {/* Add the route for ChatLog */}
          <Route
            path="/organization/:id/manage-groups"
            element={<ManageGroups />}
          />
          <Route
            path="/organization/:id/group-details/:groupId"
            element={<GroupDetails />}
          />
          <Route path="/mediaadmin/:id" element={<MediaAdmin />} />
          <Route path="/organization/:id/sobre" element={<Sobre />} />{" "}
          {/* Add the route for Sobre */}
          <Route path="/organization/:id/family" element={<Familia />} />{" "}
          {/* Add the route for Familia */}
          <Route
            path="/organization/:id/gallery-admin"
            element={<GalleryAdmin />}
          />
          <Route
            path="/organization/:id/gallery-upload"
            element={<GalleryUpload />}
          />
          <Route path="/organization/:id/gallery-view" element={<GalleryView />} />
          <Route
            path="/organization/:id/gallery-images/:galleryId"
            element={<GalleryImages />}
          />
          <Route path="/organization/:id/courses" element={<Courses />} />{" "}
          {/* Add the route for Courses */}
          <Route
            path="/organization/:id/courses/:courseId"
            element={<CourseDetail />}
          />{" "}
          {/* Add the route for CourseDetail */}
          <Route
            path="/organization/:id/course-admin"
            element={<CourseAdmin />}
          />{" "}
          {/* Add the route for CourseAdmin */}
          <Route
            path="/organization/:id/user-permissions"
            element={<UserPermissionsAdmin />}
          />
          <Route
            path="/organization/:id/find-users-test"
            element={<FindUsersTest />}
          />
          <Route
            path="/organization/:id/course-categories"
            element={<CourseCategories />}
          />{" "}
          {/* Add the route for CourseCategories */}
          <Route
            path="/organization/:id/course-manager"
            element={
              <ErrorBoundary>
                <CourseManager />
              </ErrorBoundary>
            }
          />{" "}
          {/* Add the route for CourseManager */}
          <Route path="/organization/:id/process" element={<Process />} />{" "}
          {/* Add the route for Process */}
          <Route
            path="/organization/:idIglesia/users"
            element={<UsersDropdown />}
          />{" "}
          {/* Add the route for UsersDropdown */}
          <Route
            path="/organization/:id/course/:categoryId/subcategory/:subcategoryId"
            element={<CourseDetail />}
          />{" "}
          {/* Add the route for CourseDetail with subcategory */}
          {/* Add the route for direct category access */}
          <Route
            path="/organization/:id/course/:categoryId"
            element={<CourseDetail />}
          />
          {/* Add route for /organizationDetail pattern */}
          <Route
            path="/organization/:id/courseDetail/:categoryId"
            element={<CourseDetail />}
          />
          <Route
            path="/organization/:id/process-config"
            element={
              <ProtectedRoute requireGlobalAdmin={true}>
                <ProcessConfigPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/organization/:id/admin-connect"
            element={
              <PrivateRoute roles={["admin", "global_admin"]}>
                <AdminConnect />
              </PrivateRoute>
            }
          />
          <Route
            path="/organization/:id/add-visitor"
            element={
              <PrivateRoute roles={["admin", "global_admin"]}>
                <AddVisitor />
              </PrivateRoute>
            }
          />
          <Route
            path="/organization/:id/admin-connect/:visitorId"
            element={
              <PrivateRoute roles={["admin", "global_admin"]}>
                <VisitorDetails />
              </PrivateRoute>
            }
          />
          <Route
            path="/organization/:churchId/course/:categoryId/subcategory/:subcategoryId/settings"
            element={<SubcategorySettings />}
          />
          <Route
            path="/organization/:id/mi-organizacion"
            element={<MiOrganizacion />}
          />
          <Route
            path="/organization/:id/role-manager"
            element={
              <PrivateRoute roles={["admin", "global_admin"]}>
                <RoleManager />
              </PrivateRoute>
            }
          />
          <Route
            path="/organization/:id/user-role-assignment"
            element={
              <PrivateRoute roles={["admin", "global_admin"]}>
                <UserRoleAssignment />
              </PrivateRoute>
            }
          />
          <Route path="/organization/:id/all-events" element={<AllEvents />} />
          <Route
            path="/organization/:id/event/:eventId"
            element={<EventDetails />}
          />
          <Route path="/organization/:id/church-app" element={<ChurchApp />} />
          <Route
            path="/organization/:id/event/:eventId/coordination"
            element={<EventCoordination />}
          />
          <Route
            path="/organization/:id/asistente-pastoral"
            element={
              <PrivateRoute>
                <AsistentePastoral />
              </PrivateRoute>
            }
          />
          <Route
            path="/organization/:id/easy-projector"
            element={
              <PrivateRoute>
                <EasyProjector />
              </PrivateRoute>
            }
          />
          <Route
            path="/organization/:id/broadcast/:broadcastId"
            element={<BroadcastView />}
          />
          <Route
            path="/organization/:id/broadcast3/:broadcastId"
            element={<BroadcastView3 />}
          />
          <Route
            path="/organization/:id/broadcast3/:broadcastId/control"
            element={
              <PrivateRoute>
                <BroadcastView3 isControl={true} />
              </PrivateRoute>
            }
          />
          <Route
            path="/organization/:id/member/:profileId"
            element={<MemberProfile />}
          />
          <Route 
            path="/organization/:id/member/:profileId/dashboard" 
            element={<MemberDashboard />}
          />
          {/* Add Visitor Messaging route */}
          <Route path="/organization/:id/visitor/:visitorId/messages" element={<VisitorMessages />} />
          <Route path="/organization/:id/rooms" element={<RoomsPage />} />
          <Route path="/organization/:id/inventory" element={<InventoryPage />} />
          <Route path="/organization/:id/inventory/:itemId" element={<InventoryItemDetail />} />
          <Route path="/organization/:id/finances" element={<FinancesPage />} />
          <Route path="/organization/:id/teams" element={<TeamsPage />} />
          <Route path="/organization/:id/teams/create" element={<CreateTeamPage />} />
          <Route path="/organization/:id/maintenance" element={<MaintenancePage />} />
          <Route path="/organization/:id/rooms" element={<ChurchRooms />} />
          <Route path="/organization/:id/inventory" element={<ChurchInventory />} />
          <Route path="/organization/:id/finances" element={<ChurchFinances />} />
          <Route 
            path="/organization/:id/balance-manager" 
            element={
              <PrivateRoute roles={["admin", "global_admin"]}>
                <BalanceManager />
              </PrivateRoute>
            } 
          />
          <Route 
            path="/organization/:id/balance" 
            element={
              <PrivateRoute roles={["admin", "global_admin"]}>
                <BalanceManager />
              </PrivateRoute>
            } 
          />
          <Route path="/organization/:id/teams" element={<ChurchTeams />} />
          <Route path="/organization/:id/maintenance" element={<ChurchMaintenance />} />
          <Route path="/organization/:id/rooms" element={<Rooms />} />
          <Route path="/organization/:id/inventory" element={<Inventory />} />
          <Route path="/organization/:id/finances" element={<Finances />} />
          <Route path="/organization/:id/teams" element={<Teams />} />
          <Route path="/organization/:id/maintenance" element={<Maintenance />} />
          <Route path="/organization/:id/teams/:teamId" element={<TeamDetailPage />} />
          <Route path="/organization/:id/event/:eventId/register" element={<EventRegistration />} />
          <Route path="/organization/:id/member-signup" element={<MemberSignup />} />
          <Route 
            path="/organization/:id/event/:eventId/registrations" 
            element={
              <PrivateRoute roles={["admin", "global_admin"]}>
                <EventRegistrationAdmin />
              </PrivateRoute>
            } 
          />
          <Route 
            path="/organization/:id/event/:eventId/manage-registrations" 
            element={
              <PrivateRoute roles={["admin", "global_admin"]}>
                <EventRegistrationAdmin />
              </PrivateRoute>
            } 
          />
          <Route
            path="/organization/:id/user-dashboard"
            element={
              <PrivateRoute>
                <UserBIDashboard />
              </PrivateRoute>
            }
          />
          <Route
            path="/organization/:id/build-my-church"
            element={
              <PrivateRoute>
                <BuildMyChurch />
              </PrivateRoute>
            }
          />
          <Route path="/organization/:id/messages" element={
            <RequireAuth>
              <Messages />
            </RequireAuth>
          } />
          <Route
            path="/organization/:id/song-manager"
            element={
              <PrivateRoute roles={["admin", "global_admin"]}>
                <SongManager />
              </PrivateRoute>
            }
          />
          
          {/* Message Log Routes */}
          <Route 
            path="/organization/:id/message-log/:type/:entityId" 
            element={
              <PrivateRoute roles={["admin", "global_admin"]}>
                <MessageLogView />
              </PrivateRoute>
            } 
          />
          
          {/* Visitor Message Log Shortcut */}
          <Route 
            path="/organization/:id/visitor-log/:visitorId" 
            element={
              <Navigate to={params => `/organization/${params.id}/message-log/visitor/${params.visitorId}`} replace />
            } 
          />
          
          {/* Member Message Log Shortcut */}
          <Route 
            path="/organization/:id/member-log/:memberId" 
            element={
              <Navigate to={params => `/organization/${params.id}/message-log/member/${params.memberId}`} replace />
            } 
          />
          
          {/* Course Analytics Route */}
          <Route
            path="/organization/:id/course-analytics"
            element={
              <PrivateRoute roles={["admin", "global_admin"]}>
                <CourseAnalytics />
              </PrivateRoute>
            }
          />
          
          {/* Business Intelligence Dashboard Route */}
          <Route
            path="/organization/:id/bi-dashboard"
            element={
              <PrivateRoute roles={["admin", "global_admin"]}>
                <BIDashboard />
              </PrivateRoute>
            }
          />
          
          {/* My Plan Route */}
          <Route
            path="/organization/:id/my-plan"
            element={
              <PrivateRoute roles={["admin", "global_admin"]}>
                <MyPlan />
              </PrivateRoute>
            }
          />
          
          {/* Product Manager Routes */}
          <Route
            path="/organization/:id/product-manager"
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
            path="/organization/:id/invoices" 
            element={
              <PrivateRoute roles={["admin", "global_admin"]}>
                <InvoiceManager />
              </PrivateRoute>
            } 
          />
          
          {/* SocialMedia Route */}
          <Route 
            path="/organization/:id/social-media" 
            element={
              <PrivateRoute roles={["admin", "global_admin"]}>
                <SocialMedia />
              </PrivateRoute>
            } 
          />
          
          {/* SocialMediaAccounts Route */}
          <Route 
            path="/organization/:id/social-media-accounts" 
            element={
              <PrivateRoute roles={["admin", "global_admin"]}>
                <SocialMediaAccounts />
              </PrivateRoute>
            } 
          />
          
          {/* Forms Route */}
          <Route 
            path="/organization/:id/forms" 
            element={
              <PrivateRoute roles={["admin", "global_admin", "member"]}>
                <ErrorBoundary>
                  <Forms />
                </ErrorBoundary>
              </PrivateRoute>
            } 
          />
          
          {/* Form Entries Route */}
          <Route 
            path="/organization/:id/forms/:formId/entries" 
            element={
              <PrivateRoute roles={["admin", "global_admin", "member"]}>
                <ErrorBoundary>
                  <FormEntriesPage />
                </ErrorBoundary>
              </PrivateRoute>
            } 
          />
          
          {/* Time Tracker Route */}
          <Route 
            path="/organization/:id/time-tracker" 
            element={
              <PrivateRoute>
                <TimeTracker />
              </PrivateRoute>
            } 
          />
          <Route 
            path="/organization/:id/timer-page" 
            element={
              <PrivateRoute>
                <TimerPage />
              </PrivateRoute>
            } 
          />
          
          {/* Public Form Viewer Route */}
          <Route 
            path="/organization/:id/form/:formId" 
            element={
              <ErrorBoundary>
                <FormViewer />
              </ErrorBoundary>
            }
          />
          
          {/* Embeddable Form Route */}
          <Route 
            path="/organization/:id/embed/:formId" 
            element={<FormEmbed />}
          />
          
          <Route path="/organization/:id/leica" element={<LeicaModule />} />
          <Route path="/global-organization-manager" element={<GlobalOrganizationManager />} />
          <Route path="/church-profile/:id" element={<ChurchProfile />} />
          <Route path="/church/:id/course-categories" element={<CourseCategories />} />
          <Route path="/church/:id/course/:categoryId/subcategory/:subcategoryId" element={<CourseDetail />} />
          <Route path="/church/:id/course/:categoryId/subcategory/:subcategoryId/settings" element={<SubcategorySettings />} />
          <Route path="/church/:id/forms" element={<Forms />} />
          <Route path="/church/:id/bible" element={<BiblePage />} />
          <Route path="/church/:id/events" element={<EventsPage />} />
          <Route path="/church/:id/mi-perfil" element={<MiPerfil />} />
          <Route path="/church/:id/login" element={<Login />} />
          <Route path="/church/:id/form/:formId" element={
            <ErrorBoundary>
              <FormViewer />
            </ErrorBoundary>
          } />
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
