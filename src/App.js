import React, { Suspense } from "react";
import {
  BrowserRouter as Router,
  Route,
  Routes,
  Navigate,
  useParams,
} from "react-router-dom";
import Login from "./components/Login"; // Ensure the path is correct
import Register from "./components/Register";
import ProtectedRoute from "./components/ProtectedRoute"; // Protect Only `/mi-perfil`
import RequireAuth from "./components/RequireAuth"; // Add this import
import { AuthProvider } from "./contexts/AuthContext"; // Import AuthProvider
import ErrorBoundary from "./components/ErrorBoundary"; // Import ErrorBoundary component
import PrivateRoute from "./components/PrivateRoute"; // Import PrivateRoute component
import "bootstrap/dist/css/bootstrap.min.css";
import { SafeToastContainer } from "./utils/toastUtils";
import "react-toastify/dist/ReactToastify.css";

// Loading fallback component
const LoadingFallback = () => (
  <div style={{
    display: 'flex',
    justifyContent: 'center',
    alignItems: 'center',
    height: '100vh',
    fontSize: '18px',
    color: '#666'
  }}>
    Loading...
  </div>
);

const BuildBIRedirect = () => {
  const { id } = useParams();
  return <Navigate to={`/organization/${id}/bi-dashboard`} replace />;
};

// Lazy load route components so the login page does not pull the full app graph up front.
const ChurchInfo = React.lazy(() => import("./pages/ChurchInfo"));
const MiPerfil = React.lazy(() => import("./components/MiPerfil"));
const ProfilePage = React.lazy(() => import("./components/ProfilePage"));
const Search = React.lazy(() => import("./components/Search"));
const EventsPage = React.lazy(() => import("./pages/EventsPage"));
const GroupsPage = React.lazy(() => import("./pages/GroupsPage"));
const DirectoryPage = React.lazy(() => import("./pages/DirectoryPage"));
const ContactPage = React.lazy(() => import("./pages/ContactPage"));
const ArticlesPage = React.lazy(() => import("./pages/ArticlesPage"));
const MediaPage = React.lazy(() => import("./components/MediaPage"));
const MediaDetailPage = React.lazy(() => import("./components/MediaDetailPage"));
const GalleryPage = React.lazy(() => import("./pages/GalleryPage"));
const BiblePage = React.lazy(() => import("./pages/BiblePage"));
const LetterGeneratorPage = React.lazy(() => import("./components/ChurchLetterGenerator"));
const Chat = React.lazy(() => import("./components/Chat"));
const GroupList = React.lazy(() => import("./components/GroupList"));
const Admin = React.lazy(() => import("./components/Admin"));
const ArticlePageDetail = React.lazy(() => import("./pages/ArticleDetailPage"));
const VideoPage = React.lazy(() => import("./pages/VideoPage"));
const AudioPage = React.lazy(() => import("./pages/AudioPage"));
const PDFPage = React.lazy(() => import("./pages/PDFPage"));
const ChatV2 = React.lazy(() => import("./components/ChatV2"));
const ChatLog = React.lazy(() => import("./components/ChatLog"));
const MediaAdmin = React.lazy(() => import("./components/mediaadmin"));
const Sobre = React.lazy(() => import("./components/Sobre"));
const Familia = React.lazy(() => import("./components/Familia"));
const GalleryAdmin = React.lazy(() => import("./components/galleryadmin"));
const GalleryView = React.lazy(() => import("./components/galleryview"));
const GalleryUpload = React.lazy(() => import("./components/galleryupload"));
const GalleryImages = React.lazy(() => import("./components/GalleryImages"));
const Courses = React.lazy(() => import("./components/Courses"));
const CourseDetail = React.lazy(() => import("./components/CourseDetail"));
const CourseAdmin = React.lazy(() => import("./components/CourseAdmin"));
const CourseCategories = React.lazy(() => import("./components/CourseCategories"));
const CourseManager = React.lazy(() => import("./components/CourseManager"));
const Process = React.lazy(() => import("./components/Process"));
const FindUsersTest = React.lazy(() => import("./components/FindUsersTest"));
const UserPermissionsAdmin = React.lazy(() => import("./components/UserPermissionsAdmin"));
const UsersDropdown = React.lazy(() => import("./components/UsersDropdown"));
const ProcessConfigPage = React.lazy(() => import("./pages/ProcessConfigPage"));
const AdminConnect = React.lazy(() => import("./components/AdminConnect"));
const AddVisitor = React.lazy(() => import("./components/AddVisitor"));
const SubcategorySettings = React.lazy(() => import("./components/SubcategorySettings"));
const MiOrganizacion = React.lazy(() => import("./components/MiOrganizacion"));
const AllEvents = React.lazy(() => import("./components/AllEvents"));
const ChurchApp = React.lazy(() => import("./components/ChurchApp"));
const EventDetails = React.lazy(() => import("./components/EventDetails"));
<<<<<<< HEAD
const VisitorDetails = React.lazy(() => import("./components/VisitorDetails"));
const EventCoordination = React.lazy(() => import("./components/EventCoordination"));
const ManageGroups = React.lazy(() => import("./components/ManageGroups"));
const GroupDetails = React.lazy(() => import("./components/GroupDetails"));
const AsistentePastoral = React.lazy(() => import("./components/AsistentePastoral"));
const EasyProjector = React.lazy(() => import("./components/EasyProjector"));
const BroadcastView = React.lazy(() => import("./components/BroadcastView"));
const BroadcastView3 = React.lazy(() => import("./components/BroadcastView3"));
const MemberProfile = React.lazy(() => import("./components/MemberProfile"));
const MemberDashboard = React.lazy(() => import("./components/MemberDashboard"));
const VisitorMessages = React.lazy(() => import("./components/VisitorMessages"));
const DonorUploader = React.lazy(() => import("./components/DonorUploader"));
const DonorManager = React.lazy(() => import("./components/DonorManager"));
const DonorsPage = React.lazy(() => import("./components/DonorsPage"));
const RoomsPage = React.lazy(() => import("./pages/ChurchSubPages").then((module) => ({ default: module.RoomsPage })));
const InventoryPage = React.lazy(() => import("./pages/ChurchSubPages").then((module) => ({ default: module.InventoryPage })));
const FinancesPage = React.lazy(() => import("./pages/ChurchSubPages").then((module) => ({ default: module.FinancesPage })));
const TeamsPage = React.lazy(() => import("./pages/ChurchSubPages").then((module) => ({ default: module.TeamsPage })));
const MaintenancePage = React.lazy(() => import("./pages/ChurchSubPages").then((module) => ({ default: module.MaintenancePage })));
const ChurchRooms = React.lazy(() => import("./pages/church/Rooms"));
const ChurchInventory = React.lazy(() => import("./pages/church/Inventory"));
const ChurchFinances = React.lazy(() => import("./pages/church/Finances"));
const ChurchTeams = React.lazy(() => import("./pages/church/Teams"));
const ChurchMaintenance = React.lazy(() => import("./pages/church/Maintenance"));
const Rooms = React.lazy(() => import("./pages/church/Rooms"));
const Inventory = React.lazy(() => import("./pages/church/Inventory"));
const Finances = React.lazy(() => import("./pages/church/Finances"));
const Teams = React.lazy(() => import("./pages/church/Teams"));
const Maintenance = React.lazy(() => import("./pages/church/Maintenance"));
const CreateTeamPage = React.lazy(() => import("./pages/ChurchSubPages/CreateTeamPage"));
const TeamDetailPage = React.lazy(() => import("./pages/ChurchSubPages/TeamDetailPage"));
const EventRegistration = React.lazy(() => import("./components/EventRegistration"));
const EventRegistrationAdmin = React.lazy(() => import("./components/EventRegistrationAdmin"));
const MemberSignup = React.lazy(() => import("./components/MemberSignup.clean"));
const BuildMyChurch = React.lazy(() => import("./components/BuildMyChurch"));
const Messages = React.lazy(() => import("./components/Messages"));
const BalanceManager = React.lazy(() => import("./components/BalanceManager"));
const SongManager = React.lazy(() => import("./components/SongManager"));
const InventoryItemDetail = React.lazy(() => import("./components/InventoryItemDetail"));
const MessageLogView = React.lazy(() => import("./components/MessageLogView"));
const CourseAnalytics = React.lazy(() => import("./components/CourseAnalytics"));
const BIDashboard = React.lazy(() => import("./components/BIDashboard"));
const UserBIDashboard = React.lazy(() => import("./components/UserBIDashboard"));
const MyPlan = React.lazy(() => import("./components/MyPlan"));
const ProductManager = React.lazy(() => import("./components/ProductManager"));
const InvoiceManager = React.lazy(() => import("./components/InvoiceManager"));
const SocialMedia = React.lazy(() => import("./components/SocialMedia"));
const SocialMediaAccounts = React.lazy(() => import("./components/SocialMediaAccounts"));
const LeicaModule = React.lazy(() => import("./components/LeicaModule"));
const RoleManager = React.lazy(() => import("./components/RoleManager"));
const UserRoleAssignment = React.lazy(() => import("./components/UserRoleAssignment"));
const Forms = React.lazy(() => import("./components/Forms"));
const FormViewer = React.lazy(() => import("./components/FormViewer"));
const FormEmbed = React.lazy(() => import("./components/FormEmbed"));
const FormEntriesPage = React.lazy(() => import("./components/FormEntriesPage"));
const TimeTracker = React.lazy(() => import("./components/TimeTracker"));
const TimerPage = React.lazy(() => import("./components/TimerPage"));
const TaskProgressDetail = React.lazy(() => import("./components/TaskProgressDetail"));
const GlobalOrganizationManager = React.lazy(() => import("./components/GlobalOrganizationManager"));
const ChurchProfile = React.lazy(() => import("./components/ChurchProfile"));
const FreshBooksCallback = React.lazy(() => import("./components/FreshBooksCallback"));
const SqlServerBridge = React.lazy(() => import("./components/SqlServerBridge"));
const ExcelRowDetail = React.lazy(() => import("./components/ExcelRowDetail"));
const BIMModule = React.lazy(() => import("./components/BIMModule"));
const ProjectIssueDashboard = React.lazy(() => import("./components/ProjectIssueDashboard"));
=======
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
import DonorUploader from './components/DonorUploader';
import DonorManager from './components/DonorManager';
import DonorsPage from './components/DonorsPage';
import {
  RoomsPage,
  InventoryPage,
  FinancesPage,
  TeamsPage,
  MaintenancePage
} from './pages/ChurchSubPages';
import CampusesPage from './pages/organization/CampusesPage';
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
import TaskProgressDetail from "./components/TaskProgressDetail"; // Import TaskProgressDetail component
import MySunday from "./components/MySunday";
import GlobalOrganizationManager from "./components/GlobalOrganizationManager";
import ChurchProfile from "./components/ChurchProfile";
import FreshBooksCallback from "./components/FreshBooksCallback";
import SqlServerBridge from "./components/SqlServerBridge";
import ExcelRowDetail from "./components/ExcelRowDetail";
>>>>>>> a9f287621fea87e41e80addac008388e602a9522

const App = () => {
  return (
    <AuthProvider>
      <ErrorBoundary>
        <Router future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
          <Suspense fallback={<LoadingFallback />}>
            <Routes>
          <Route path="/" element={<ErrorBoundary><Search /></ErrorBoundary>} />{" "}
          {/* Set Search as the main page */}
          <Route path="/organization/:id" element={<ErrorBoundary><ChurchApp /></ErrorBoundary>} />
          <Route path="/organization/:id/info" element={<ErrorBoundary><ChurchInfo /></ErrorBoundary>} />
          <Route path="/organization/:id/mi-perfil" element={<ErrorBoundary><MiPerfil /></ErrorBoundary>} />
          <Route path="/organization/:id/profile" element={<ErrorBoundary><ProfilePage /></ErrorBoundary>} />
          <Route path="/organization/:id/search" element={<ErrorBoundary><Search /></ErrorBoundary>} />
          <Route path="/organization/:id/events" element={<ErrorBoundary><EventsPage /></ErrorBoundary>} />
          <Route path="/organization/:id/groups" element={<ErrorBoundary><GroupsPage /></ErrorBoundary>} />
          <Route path="/organization/:id/directory" element={<ErrorBoundary><DirectoryPage /></ErrorBoundary>} />
          <Route path="/organization/:id/contact" element={<ErrorBoundary><ContactPage /></ErrorBoundary>} />
          <Route path="/organization/:id/articles" element={<ErrorBoundary><ArticlesPage /></ErrorBoundary>} />
          <Route
            path="/organization/:id/articles/:articleId"
            element={<ErrorBoundary><ArticlePageDetail /></ErrorBoundary>}
          />
          <Route path="/organization/:id/media" element={<ErrorBoundary><MediaPage /></ErrorBoundary>} />{" "}
          {/* Updated route */}
          <Route
            path="/organization/:id/media/:playlistId"
            element={<ErrorBoundary><MediaDetailPage /></ErrorBoundary>}
          />{" "}
          {/* New route */}
          <Route path="/organization/:id/media/video" element={<ErrorBoundary><VideoPage /></ErrorBoundary>} />
          <Route path="/organization/:id/media/audio" element={<ErrorBoundary><AudioPage /></ErrorBoundary>} />
          <Route path="/organization/:id/media/pdf" element={<ErrorBoundary><PDFPage /></ErrorBoundary>} />
          <Route path="/organization/:id/gallery" element={<ErrorBoundary><GalleryPage /></ErrorBoundary>} />
          <Route path="/organization/:id/bible" element={<ErrorBoundary><BiblePage /></ErrorBoundary>} />
          <Route
            path="/organization/:id/letter-generator"
            element={<LetterGeneratorPage />}
          />
          <Route path="/organization/:id/login" element={<Login />} />
          <Route path="/organization/:id/register" element={<Register />} />
          <Route
            path="/group-list"
            element={
              <RequireAuth>
                <GroupList />
              </RequireAuth>
            }
          />
          <Route
            path="/chat/:groupId"
            element={
              <RequireAuth>
                <Chat />
              </RequireAuth>
            }
          />
          <Route
            path="/admin/:id"
            element={
              <RequireAuth>
                <Admin />
              </RequireAuth>
            }
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
            element={<ErrorBoundary><MiOrganizacion /></ErrorBoundary>}
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
          <Route path="/organization/:id/donors" element={<DonorsPage />} />
          <Route path="/organization/:id/donors/upload" element={<DonorUploader />} />
          <Route path="/organization/:id/donors/manage" element={<DonorManager />} />
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
          <Route path="/organization/:id/campuses" element={<CampusesPage />} />
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
          <Route
            path="/organization/:id/build-my-church/task/:taskId"
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
          <Route
            path="/organization/:id/build/bi-dashboard"
            element={
              <BuildBIRedirect />
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
            path="/organization/:id/time-tracker/brands/:rowId"
            element={
              <PrivateRoute>
                <ExcelRowDetail />
              </PrivateRoute>
            }
          />
          <Route 
            path="/organization/:id/task-progress/:taskId" 
            element={
              <PrivateRoute>
                <TaskProgressDetail />
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
          <Route
            path="/organization/:id/my-sunday"
            element={
              <PrivateRoute>
                <ErrorBoundary>
                  <MySunday />
                </ErrorBoundary>
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
          <Route
            path="/organization/:id/project-issue-dashboard"
            element={
              <PrivateRoute roles={["admin", "global_admin", "member"]}>
                <ProjectIssueDashboard />
              </PrivateRoute>
            }
          />
          <Route
            path="/organization/:id/bim"
            element={
              <PrivateRoute roles={["admin", "global_admin", "member"]}>
                <BIMModule />
              </PrivateRoute>
            }
          />
          <Route
            path="/organization/:id/bim/:projectId/view/:bimView"
            element={
              <PrivateRoute roles={["admin", "global_admin", "member"]}>
                <BIMModule />
              </PrivateRoute>
            }
          />
          <Route
            path="/organization/:id/bim/:projectId/:rowNumber"
            element={
              <PrivateRoute roles={["admin", "global_admin", "member"]}>
                <BIMModule />
              </PrivateRoute>
            }
          />
          <Route path="/global-organization-manager" element={<GlobalOrganizationManager />} />
          <Route path="/church-profile/:id" element={<ErrorBoundary><ChurchProfile /></ErrorBoundary>} />
          <Route path="/church/:id/course-categories" element={<ErrorBoundary><CourseCategories /></ErrorBoundary>} />
          <Route path="/church/:id/course/:categoryId/subcategory/:subcategoryId" element={<ErrorBoundary><CourseDetail /></ErrorBoundary>} />
          <Route path="/church/:id/course/:categoryId/subcategory/:subcategoryId/settings" element={<ErrorBoundary><SubcategorySettings /></ErrorBoundary>} />
          <Route path="/church/:id/forms" element={<ErrorBoundary><Forms /></ErrorBoundary>} />
          <Route path="/church/:id/bible" element={<ErrorBoundary><BiblePage /></ErrorBoundary>} />
          <Route path="/church/:id/events" element={<ErrorBoundary><EventsPage /></ErrorBoundary>} />
          <Route path="/church/:id/mi-perfil" element={<ErrorBoundary><MiPerfil /></ErrorBoundary>} />
          <Route path="/church/:id/mi-organizacion" element={<ErrorBoundary><MiOrganizacion /></ErrorBoundary>} />
          <Route path="/church/:id/my-sunday" element={<ErrorBoundary><MySunday /></ErrorBoundary>} />
          <Route path="/church/:id/login" element={<ErrorBoundary><Login /></ErrorBoundary>} />
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
          </Suspense>
        </Router>
      </ErrorBoundary>
      <SafeToastContainer />
    </AuthProvider>
  );
};

export default App;
