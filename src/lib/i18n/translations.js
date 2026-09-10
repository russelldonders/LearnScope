// First-pass translation coverage: the always-visible chrome (AppHeader) and
// the unauthenticated entry pages (Login/Signup/ForgotPassword) -- the
// highest-traffic, lowest-domain-jargon-risk surface, proving the language
// switch genuinely changes rendered text end to end. The rest of the app's
// strings (skills, courses, admin consoles, etc.) aren't wired up yet; see
// BACKLOG.md. English is the fallback for any key a language doesn't have,
// so adding a new language can start from a partial file without breaking
// anything.
// Named distinctly from lib/languages.js's LANGUAGES (a free-text "what
// language(s) do you speak" profile field, unrelated to which language the
// app's own UI is shown in) -- this is only ever the fixed, small set this
// codebase has actual translations for.
export const INTERFACE_LANGUAGES = [
  { value: 'en', label: 'English' },
  { value: 'es', label: 'Español' },
]

export const translations = {
  en: {
    header: {
      skipToMain: 'Skip to main content',
    },
    nav: {
      home: 'Home',
      skills: 'Skills',
      experience: 'Experience',
      learning: 'Learning',
      actions: 'Actions',
    },
    menu: {
      profile: 'Profile',
      connections: 'Connections',
      connectedApps: 'Connected Apps',
      privacySettings: 'Privacy Settings',
      importSkills: 'Import Skills & Experience',
      help: 'Help',
      platformConsole: 'Platform console',
      switchToLearner: 'Switch to learner mode',
      providerConsole: 'Provider console',
      employerConsole: 'Employer console',
      logout: 'Log out',
    },
    auth: {
      email: 'Email',
      password: 'Password',
      firstName: 'First name',
      lastName: 'Last name',
      login: {
        tagline: 'Log in to your growth log.',
        submit: 'Log in',
        submitting: 'Logging in…',
        forgotPassword: 'Forgot password?',
        noAccount: 'No account yet?',
        signUp: 'Sign up',
      },
      signup: {
        submit: 'Sign up',
        submitting: 'Creating account…',
        haveAccount: 'Already have an account?',
        logIn: 'Log in',
      },
      forgotPassword: {
        tagline: 'Reset your password.',
        submit: 'Send reset link',
        submitting: 'Sending…',
        sent: "If an account exists for that email, we've sent a link to reset your password.",
        backToLogin: 'Back to log in',
      },
    },
    profile: {
      language: {
        title: 'Language',
        description: 'Choose the language LearnScope is shown in. This follows your account to any device you sign in on.',
      },
    },
  },
  es: {
    header: {
      skipToMain: 'Saltar al contenido principal',
    },
    nav: {
      home: 'Inicio',
      skills: 'Habilidades',
      experience: 'Experiencia',
      learning: 'Aprendizaje',
      actions: 'Acciones',
    },
    menu: {
      profile: 'Perfil',
      connections: 'Conexiones',
      connectedApps: 'Aplicaciones conectadas',
      privacySettings: 'Configuración de privacidad',
      importSkills: 'Importar habilidades y experiencia',
      help: 'Ayuda',
      platformConsole: 'Consola de plataforma',
      switchToLearner: 'Cambiar a modo alumno',
      providerConsole: 'Consola de proveedor',
      employerConsole: 'Consola de empleador',
      logout: 'Cerrar sesión',
    },
    auth: {
      email: 'Correo electrónico',
      password: 'Contraseña',
      firstName: 'Nombre',
      lastName: 'Apellido',
      login: {
        tagline: 'Inicia sesión en tu registro de crecimiento.',
        submit: 'Iniciar sesión',
        submitting: 'Iniciando sesión…',
        forgotPassword: '¿Olvidaste tu contraseña?',
        noAccount: '¿Aún no tienes una cuenta?',
        signUp: 'Regístrate',
      },
      signup: {
        submit: 'Regístrate',
        submitting: 'Creando cuenta…',
        haveAccount: '¿Ya tienes una cuenta?',
        logIn: 'Iniciar sesión',
      },
      forgotPassword: {
        tagline: 'Restablece tu contraseña.',
        submit: 'Enviar enlace',
        submitting: 'Enviando…',
        sent: 'Si existe una cuenta con ese correo electrónico, te hemos enviado un enlace para restablecer tu contraseña.',
        backToLogin: 'Volver a iniciar sesión',
      },
    },
    profile: {
      language: {
        title: 'Idioma',
        description: 'Elige el idioma en el que se muestra LearnScope. Esto se aplica a tu cuenta en cualquier dispositivo en el que inicies sesión.',
      },
    },
  },
}
