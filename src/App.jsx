import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { AuthProvider } from './context/AuthContext'
import { ThemeProvider } from './context/ThemeContext'
import { PendingActionsProvider } from './context/PendingActionsContext'
import { NavVisibilityProvider } from './context/NavVisibilityContext'
import ProtectedRoute from './components/ProtectedRoute'
import PlatformAdminRoute from './components/PlatformAdminRoute'
import ProviderAdminRoute from './components/ProviderAdminRoute'
import EmployerAdminRoute from './components/EmployerAdminRoute'
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
import ValidateRequest from './pages/ValidateRequest'
import AdminOverview from './pages/admin/AdminOverview'
import AdminUsers from './pages/admin/AdminUsers'
import AdminUserDetail from './pages/admin/AdminUserDetail'
import AdminProviders from './pages/admin/AdminProviders'
import AdminEmployers from './pages/admin/AdminEmployers'
import AdminCatalogue from './pages/admin/AdminCatalogue'
import AdminSkills from './pages/admin/AdminSkills'
import AdminSkillDetail from './pages/admin/AdminSkillDetail'
import AdminTags from './pages/admin/AdminTags'
import AdminActivityLog from './pages/admin/AdminActivityLog'
import AdminOnboarding from './pages/admin/AdminOnboarding'
import ProviderConsole from './pages/provider/ProviderConsole'
import EmployerConsole from './pages/employer/EmployerConsole'
import ProviderCourseEditor from './pages/provider/ProviderCourseEditor'
import ProviderCatalogueDetail from './pages/provider/ProviderCatalogueDetail'
import ProviderSkillDetail from './pages/provider/ProviderSkillDetail'
import RouteTitle from './components/RouteTitle'

function App() {
  return (
    <BrowserRouter>
      <RouteTitle />
      <AuthProvider>
        <ThemeProvider>
        <PendingActionsProvider>
        <NavVisibilityProvider>
        <Routes>
          <Route path="/" element={<Landing />} />
          <Route path="/login" element={<Login />} />
          <Route path="/signup" element={<Signup />} />
          <Route path="/forgot-password" element={<ForgotPassword />} />
          <Route path="/reset-password" element={<ResetPassword />} />
          <Route path="/welcome" element={<Welcome />} />
          <Route path="/rate/:code" element={<Rate />} />
          <Route path="/recommend/:code" element={<Recommend />} />
          <Route path="/shared/:token" element={<SharedProfile />} />
          <Route path="/providers/:slug" element={<ProviderProfile />} />
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
            path="/provider"
            element={
              <ProviderAdminRoute>
                <ProviderConsole />
              </ProviderAdminRoute>
            }
          />
          <Route
            path="/provider/catalogues/:catalogueId"
            element={
              <ProviderAdminRoute>
                <ProviderCatalogueDetail />
              </ProviderAdminRoute>
            }
          />
          <Route
            path="/provider/training/:courseId"
            element={
              <ProviderAdminRoute>
                <ProviderCourseEditor />
              </ProviderAdminRoute>
            }
          />
          <Route
            path="/provider/organisations/:organisationId/skills/:skillId"
            element={
              <ProviderAdminRoute>
                <ProviderSkillDetail />
              </ProviderAdminRoute>
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
            path="/admin/providers"
            element={
              <PlatformAdminRoute>
                <AdminProviders />
              </PlatformAdminRoute>
            }
          />
          <Route
            path="/admin/employers"
            element={
              <PlatformAdminRoute>
                <AdminEmployers />
              </PlatformAdminRoute>
            }
          />
          <Route
            path="/employer"
            element={
              <EmployerAdminRoute>
                <EmployerConsole />
              </EmployerAdminRoute>
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
            path="/admin/activity"
            element={
              <PlatformAdminRoute>
                <AdminActivityLog />
              </PlatformAdminRoute>
            }
          />
          <Route
            path="/admin/onboarding"
            element={
              <PlatformAdminRoute>
                <AdminOnboarding />
              </PlatformAdminRoute>
            }
          />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
        </NavVisibilityProvider>
        </PendingActionsProvider>
        </ThemeProvider>
      </AuthProvider>
    </BrowserRouter>
  )
}

export default App
