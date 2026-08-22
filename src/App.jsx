import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { AuthProvider } from './context/AuthContext'
import { PendingActionsProvider } from './context/PendingActionsContext'
import ProtectedRoute from './components/ProtectedRoute'
import Landing from './pages/Landing'
import Login from './pages/Login'
import Signup from './pages/Signup'
import ForgotPassword from './pages/ForgotPassword'
import ResetPassword from './pages/ResetPassword'
import Welcome from './pages/Welcome'
import Onboarding from './pages/Onboarding'
import Dashboard from './pages/Dashboard'
import Skills from './pages/Skills'
import SkillDetail from './pages/SkillDetail'
import Experience from './pages/Experience'
import ExperienceDetail from './pages/ExperienceDetail'
import Profile from './pages/Profile'
import ProfilePrivacy from './pages/ProfilePrivacy'
import ProfileImport from './pages/ProfileImport'
import Rate from './pages/Rate'
import Connections from './pages/Connections'
import SkillsProfile from './pages/SkillsProfile'
import CourseCatalogue from './pages/CourseCatalogue'
import CourseDetail from './pages/CourseDetail'
import CourseLearn from './pages/CourseLearn'
import Learning from './pages/Learning'
import ValidateRequest from './pages/ValidateRequest'

function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <PendingActionsProvider>
        <Routes>
          <Route path="/" element={<Landing />} />
          <Route path="/login" element={<Login />} />
          <Route path="/signup" element={<Signup />} />
          <Route path="/forgot-password" element={<ForgotPassword />} />
          <Route path="/reset-password" element={<ResetPassword />} />
          <Route path="/welcome" element={<Welcome />} />
          <Route path="/rate/:code" element={<Rate />} />
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
            path="/profile/import"
            element={
              <ProtectedRoute>
                <ProfileImport />
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
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
        </PendingActionsProvider>
      </AuthProvider>
    </BrowserRouter>
  )
}

export default App
