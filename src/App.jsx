import LtiSession from './pages/LtiSession'
import LmsConnectionsPage from './pages/provider/LtiConfiguration'
import LtiToolsPage from './pages/provider/LtiTools'
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { AuthProvider } from './context/AuthContext'
import { ThemeProvider } from './context/ThemeContext'
import { LanguageProvider } from './context/LanguageContext'
import { PendingActionsProvider } from './context/PendingActionsContext'
import { NavVisibilityProvider } from './context/NavVisibilityContext'
import ProtectedRoute from './components/ProtectedRoute'
import PlatformAdminRoute from './components/PlatformAdminRoute'
import OrganisationAdminRoute from './components/OrganisationAdminRoute'
import EmployerMemberRoute from './components/EmployerMemberRoute'
import ManagerRoute from './components/ManagerRoute'
import Landing from './pages/Landing'
import Login from './pages/Login'
import Signup from './pages/Signup'
import ForgotPassword from './pages/ForgotPassword'
import ResetPassword from './pages/ResetPassword'
import Welcome from './pages/Welcome'
import Onboarding from './pages/Onboarding'
import Dashboard from './pages/Dashboard'
import Activity from './pages/Activity'
import Skills from './pages/Skills'
import SkillDetail from './pages/SkillDetail'
import Experience from './pages/Experience'
import ExperienceDetail from './pages/ExperienceDetail'
import Profile from './pages/Profile'
import ProfilePrivacy from './pages/ProfilePrivacy'
import ConnectedAccounts from './pages/ConnectedAccounts'
import ProfileImport from './pages/ProfileImport'
import ProfileExport from './pages/ProfileExport'
import Help from './pages/Help'
import Rate from './pages/Rate'
import Recommend from './pages/Recommend'
import SharedProfile from './pages/SharedProfile'
import ProviderProfile from './pages/ProviderProfile'
import Connections from './pages/Connections'
import Actions from './pages/Actions'
import SkillsProfile from './pages/SkillsProfile'
import CourseCatalogue from './pages/CourseCatalogue'
import CourseDetail from './pages/CourseDetail'
import CourseLearn from './pages/CourseLearn'
import Learning from './pages/Learning'
import MyTeam from './pages/MyTeam'
import ValidateRequest from './pages/ValidateRequest'
import AdminOverview from './pages/admin/AdminOverview'
import AdminUsers from './pages/admin/AdminUsers'
import AdminUserDetail from './pages/admin/AdminUserDetail'
import AdminProviders from './pages/admin/AdminProviders'
import AdminCatalogue from './pages/admin/AdminCatalogue'
import AdminCourseDetail from './pages/admin/AdminCourseDetail'
import AdminSkills from './pages/admin/AdminSkills'
import AdminSkillDetail from './pages/admin/AdminSkillDetail'
import AdminTags from './pages/admin/AdminTags'
import AdminSettings from './pages/admin/AdminSettings'
import EmployerHome from './pages/employer/EmployerHome'
import EmployerRoleProfileDetail from './pages/employer/EmployerRoleProfileDetail'
import ProviderCourseEditor from './pages/provider/ProviderCourseEditor'
import ProviderCatalogueDetail from './pages/provider/ProviderCatalogueDetail'
import ProviderSkillDetail from './pages/provider/ProviderSkillDetail'
import OrganisationWorkspace from './pages/organisation/OrganisationWorkspace'
import RouteTitle from './components/RouteTitle'
import ErrorBoundary from './components/ErrorBoundary'

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
