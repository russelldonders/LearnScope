import { Suspense } from 'react'
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { AuthProvider } from './context/AuthContext'
import { ThemeProvider } from './context/ThemeContext'
import { LanguageProvider } from './context/LanguageContext'
import { PendingActionsProvider } from './context/PendingActionsContext'
import { NavVisibilityProvider } from './context/NavVisibilityContext'
import { lazyRoute } from './lib/lazyRoute'
import RouteLoading from './components/RouteLoading'
import ProtectedRoute from './components/ProtectedRoute'
import PlatformAdminRoute from './components/PlatformAdminRoute'
import OrganisationAdminRoute from './components/OrganisationAdminRoute'
import EmployerMemberRoute from './components/EmployerMemberRoute'
import ManagerRoute from './components/ManagerRoute'
import Landing from './pages/Landing'
import Login from './pages/Login'
import RouteTitle from './components/RouteTitle'
import ErrorBoundary from './components/ErrorBoundary'

// Each page is its own chunk, so a visitor only downloads the screens they
// open -- the login page no longer ships the admin console or course editor.
const LtiSession = lazyRoute(() => import('./pages/LtiSession'))
const LmsConnectionsPage = lazyRoute(() => import('./pages/provider/LtiConfiguration'))
const LtiToolsPage = lazyRoute(() => import('./pages/provider/LtiTools'))
const Signup = lazyRoute(() => import('./pages/Signup'))
const ForgotPassword = lazyRoute(() => import('./pages/ForgotPassword'))
const ResetPassword = lazyRoute(() => import('./pages/ResetPassword'))
const Welcome = lazyRoute(() => import('./pages/Welcome'))
const Onboarding = lazyRoute(() => import('./pages/Onboarding'))
const Dashboard = lazyRoute(() => import('./pages/Dashboard'))
const Activity = lazyRoute(() => import('./pages/Activity'))
const Skills = lazyRoute(() => import('./pages/Skills'))
const SkillDetail = lazyRoute(() => import('./pages/SkillDetail'))
const Experience = lazyRoute(() => import('./pages/Experience'))
const ExperienceDetail = lazyRoute(() => import('./pages/ExperienceDetail'))
const Profile = lazyRoute(() => import('./pages/Profile'))
const ProfilePrivacy = lazyRoute(() => import('./pages/ProfilePrivacy'))
const ConnectedAccounts = lazyRoute(() => import('./pages/ConnectedAccounts'))
const ProfileImport = lazyRoute(() => import('./pages/ProfileImport'))
const ProfileExport = lazyRoute(() => import('./pages/ProfileExport'))
const Help = lazyRoute(() => import('./pages/Help'))
const Rate = lazyRoute(() => import('./pages/Rate'))
const Recommend = lazyRoute(() => import('./pages/Recommend'))
const SharedProfile = lazyRoute(() => import('./pages/SharedProfile'))
const ProviderProfile = lazyRoute(() => import('./pages/ProviderProfile'))
const Connections = lazyRoute(() => import('./pages/Connections'))
const Actions = lazyRoute(() => import('./pages/Actions'))
const SkillsProfile = lazyRoute(() => import('./pages/SkillsProfile'))
const CourseCatalogue = lazyRoute(() => import('./pages/CourseCatalogue'))
const CourseDetail = lazyRoute(() => import('./pages/CourseDetail'))
const CourseLearn = lazyRoute(() => import('./pages/CourseLearn'))
const Learning = lazyRoute(() => import('./pages/Learning'))
const MyTeam = lazyRoute(() => import('./pages/MyTeam'))
const ValidateRequest = lazyRoute(() => import('./pages/ValidateRequest'))
const AdminOverview = lazyRoute(() => import('./pages/admin/AdminOverview'))
const AdminUsers = lazyRoute(() => import('./pages/admin/AdminUsers'))
const AdminUserDetail = lazyRoute(() => import('./pages/admin/AdminUserDetail'))
const AdminProviders = lazyRoute(() => import('./pages/admin/AdminProviders'))
const AdminCatalogue = lazyRoute(() => import('./pages/admin/AdminCatalogue'))
const AdminCourseDetail = lazyRoute(() => import('./pages/admin/AdminCourseDetail'))
const AdminSkills = lazyRoute(() => import('./pages/admin/AdminSkills'))
const AdminSkillDetail = lazyRoute(() => import('./pages/admin/AdminSkillDetail'))
const AdminTags = lazyRoute(() => import('./pages/admin/AdminTags'))
const AdminSettings = lazyRoute(() => import('./pages/admin/AdminSettings'))
const EmployerHome = lazyRoute(() => import('./pages/employer/EmployerHome'))
const EmployerRoleProfileDetail = lazyRoute(() => import('./pages/employer/EmployerRoleProfileDetail'))
const ProviderCourseEditor = lazyRoute(() => import('./pages/provider/ProviderCourseEditor'))
const ProviderCatalogueDetail = lazyRoute(() => import('./pages/provider/ProviderCatalogueDetail'))
const ProviderSkillDetail = lazyRoute(() => import('./pages/provider/ProviderSkillDetail'))
const OrganisationWorkspace = lazyRoute(() => import('./pages/organisation/OrganisationWorkspace'))

function App() {
  return (
    <BrowserRouter>
      <RouteTitle />
      <ErrorBoundary>
      <AuthProvider>
        <ThemeProvider>
        <LanguageProvider>
        <PendingActionsProvider>
        <NavVisibilityProvider>
        <Suspense fallback={<RouteLoading />}>
        <Routes>
          <Route path="/" element={<Landing />} />
          <Route path="/lti/session" element={<LtiSession />} />
          <Route path="/lti/deep-link" element={<LtiSession />} />
          <Route path="/lti/resources/:objectId" element={<LtiSession />} />
          <Route path="/login" element={<Login />} />
          <Route path="/signup" element={<Signup />} />
          <Route path="/forgot-password" element={<ForgotPassword />} />
          <Route path="/reset-password" element={<ResetPassword />} />
          <Route path="/welcome" element={<Welcome />} />
          <Route path="/rate/:code" element={<Rate />} />
          <Route path="/recommend/:code" element={<Recommend />} />
          <Route path="/shared/:token" element={<SharedProfile />} />
          <Route path="/organisations/:slug" element={<ProviderProfile />} />
          <Route
            path="/onboarding"
            element={
              <ProtectedRoute>
                <Onboarding />
              </ProtectedRoute>
            }
          />
          <Route
            path="/dashboard"
            element={
              <ProtectedRoute>
                <Dashboard />
              </ProtectedRoute>
            }
          />
          <Route
            path="/activity"
            element={
              <ProtectedRoute>
                <Activity />
              </ProtectedRoute>
            }
          />
          <Route
            path="/skills"
            element={
              <ProtectedRoute>
                <Skills />
              </ProtectedRoute>
            }
          />
          <Route
            path="/skills/:id"
            element={
              <ProtectedRoute>
                <SkillDetail />
              </ProtectedRoute>
            }
          />
          <Route
            path="/experience"
            element={
              <ProtectedRoute>
                <Experience />
              </ProtectedRoute>
            }
          />
          <Route
            path="/experience/:id"
            element={
              <ProtectedRoute>
                <ExperienceDetail />
              </ProtectedRoute>
            }
          />
          <Route
            path="/profile"
            element={
              <ProtectedRoute>
                <Profile />
              </ProtectedRoute>
            }
          />
          <Route
            path="/profile/privacy"
            element={
              <ProtectedRoute>
                <ProfilePrivacy />
              </ProtectedRoute>
            }
          />
          <Route
            path="/profile/connected-accounts"
            element={
              <ProtectedRoute>
                <ConnectedAccounts />
              </ProtectedRoute>
            }
          />
          <Route
            path="/profile/import"
            element={
              <ProtectedRoute>
                <ProfileImport />
              </ProtectedRoute>
            }
          />
          <Route
            path="/profile/export"
            element={
              <ProtectedRoute>
                <ProfileExport />
              </ProtectedRoute>
            }
          />
          <Route
            path="/help"
            element={
              <ProtectedRoute>
                <Help />
              </ProtectedRoute>
            }
          />
          <Route
            path="/connections"
            element={
              <ProtectedRoute>
                <Connections />
              </ProtectedRoute>
            }
          />
          <Route
            path="/actions"
            element={
              <ProtectedRoute>
                <Actions />
              </ProtectedRoute>
            }
          />
          <Route
            path="/training"
            element={
              <ProtectedRoute>
                <CourseCatalogue />
              </ProtectedRoute>
            }
          />
          <Route
            path="/learning"
            element={
              <ProtectedRoute>
                <Learning />
              </ProtectedRoute>
            }
          />
          <Route
            path="/team"
            element={
              <ManagerRoute>
                <MyTeam />
              </ManagerRoute>
            }
          />
          <Route
            path="/team/:employeeMemberId"
            element={
              <ManagerRoute>
                <MyTeam />
              </ManagerRoute>
            }
          />
          <Route
            path="/courses/:id"
            element={
              <ProtectedRoute>
                <CourseDetail />
              </ProtectedRoute>
            }
          />
          <Route
            path="/courses/:id/learn"
            element={
              <ProtectedRoute>
                <CourseLearn />
              </ProtectedRoute>
            }
          />
          <Route
            path="/skills-profile/:userId"
            element={
              <ProtectedRoute>
                <SkillsProfile />
              </ProtectedRoute>
            }
          />
          <Route
            path="/validate-request/:requestId"
            element={
              <ProtectedRoute>
                <ValidateRequest />
              </ProtectedRoute>
            }
          />
          <Route
            path="/organisation"
            element={
              <OrganisationAdminRoute>
                <OrganisationWorkspace />
              </OrganisationAdminRoute>
            }
          />
          <Route
            path="/organisation/catalogues/:catalogueId"
            element={
              <OrganisationAdminRoute>
                <ProviderCatalogueDetail />
              </OrganisationAdminRoute>
            }
          />
          <Route
            path="/organisation/training/:courseId"
            element={
              <OrganisationAdminRoute>
                <ProviderCourseEditor />
              </OrganisationAdminRoute>
            }
          />
          <Route
            path="/organisation/organisations/:organisationId/lms-connections"
            element={<OrganisationAdminRoute><LmsConnectionsPage /></OrganisationAdminRoute>}
          />
          <Route
            path="/organisation/organisations/:organisationId/lti-tools"
            element={<OrganisationAdminRoute><LtiToolsPage /></OrganisationAdminRoute>}
          />
          <Route
            path="/organisation/organisations/:organisationId/skills/:skillId"
            element={
              <OrganisationAdminRoute>
                <ProviderSkillDetail />
              </OrganisationAdminRoute>
            }
          />
          <Route
            path="/admin"
            element={
              <PlatformAdminRoute>
                <AdminOverview />
              </PlatformAdminRoute>
            }
          />
          <Route
            path="/admin/users"
            element={
              <PlatformAdminRoute>
                <AdminUsers />
              </PlatformAdminRoute>
            }
          />
          <Route
            path="/admin/users/:userId"
            element={
              <PlatformAdminRoute>
                <AdminUserDetail />
              </PlatformAdminRoute>
            }
          />
          <Route
            path="/admin/organisations"
            element={
              <PlatformAdminRoute>
                <AdminProviders />
              </PlatformAdminRoute>
            }
          />
          <Route
            path="/organisation/learning"
            element={
              <EmployerMemberRoute>
                <EmployerHome />
              </EmployerMemberRoute>
            }
          />
          <Route
            path="/organisation/roles/:roleProfileId"
            element={
              <OrganisationAdminRoute>
                <EmployerRoleProfileDetail />
              </OrganisationAdminRoute>
            }
          />
          <Route
            path="/admin/catalogue"
            element={
              <PlatformAdminRoute>
                <AdminCatalogue />
              </PlatformAdminRoute>
            }
          />
          <Route
            path="/admin/catalogue/:courseId"
            element={
              <PlatformAdminRoute>
                <AdminCourseDetail />
              </PlatformAdminRoute>
            }
          />
          <Route
            path="/admin/skills"
            element={
              <PlatformAdminRoute>
                <AdminSkills />
              </PlatformAdminRoute>
            }
          />
          <Route
            path="/admin/skills/:skillId"
            element={
              <PlatformAdminRoute>
                <AdminSkillDetail />
              </PlatformAdminRoute>
            }
          />
          <Route
            path="/admin/tags"
            element={
              <PlatformAdminRoute>
                <AdminTags />
              </PlatformAdminRoute>
            }
          />
          <Route
            path="/admin/settings"
            element={
              <PlatformAdminRoute>
                <AdminSettings />
              </PlatformAdminRoute>
            }
          />
          <Route path="/admin/onboarding" element={<Navigate to="/admin/settings#first-login-journey" replace />} />
          <Route path="/admin/notifications" element={<Navigate to="/admin/settings#notifications" replace />} />
          <Route path="/admin/releases" element={<Navigate to="/admin/settings#whats-new" replace />} />
          <Route path="/admin/activity" element={<Navigate to="/admin/settings#audit-log" replace />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
        </Suspense>
        </NavVisibilityProvider>
        </PendingActionsProvider>
        </LanguageProvider>
        </ThemeProvider>
      </AuthProvider>
      </ErrorBoundary>
    </BrowserRouter>
  )
}

export default App
