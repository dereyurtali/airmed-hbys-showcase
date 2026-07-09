/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  // A6 schedule: AppointmentTypeMeta dynamic class kombinasyonları (8 tip × bg/text/border).
  // Tailwind JIT runtime stringlerini çözemediği için safelist gerekli.
  // Pattern listesi appointment.constants.ts'deki APPOINTMENT_TYPE_META ile bire bir eşleşir.
  safelist: [
    {
      pattern: /^(bg|text|border)-(sky|emerald|violet|rose|amber|fuchsia|orange|teal)-(100|700)$/,
    },
  ],
  theme: {
    container: {
      center: true,
      padding: '2rem',
      screens: { '2xl': '1400px' },
    },
    extend: {
      fontFamily: {
        // #1018 — Inter Variable self-host (index.css @fontsource import'u).
        sans: [
          'Inter Variable',
          '-apple-system',
          'BlinkMacSystemFont',
          'Segoe UI',
          'Roboto',
          'sans-serif',
        ],
      },
      colors: {
        border: 'hsl(var(--border))',
        input: 'hsl(var(--input))',
        ring: 'hsl(var(--ring))',
        background: 'hsl(var(--background))',
        foreground: 'hsl(var(--foreground))',
        primary: {
          DEFAULT: 'hsl(var(--primary))',
          foreground: 'hsl(var(--primary-foreground))',
        },
        destructive: {
          DEFAULT: 'hsl(var(--destructive))',
          foreground: 'hsl(var(--destructive-foreground))',
        },
        muted: {
          DEFAULT: 'hsl(var(--muted))',
          foreground: 'hsl(var(--muted-foreground))',
        },
        // Bölüm 24.1 — durum (tint zemin + ince kenar + metin). hsl değil:
        // değerler doğrudan CSS var'larından (hex/rgba), light+dark parity.
        critical: {
          DEFAULT: 'var(--crit-pure)',
          bg: 'var(--crit-bg)',
          border: 'var(--crit-bd)',
          foreground: 'var(--crit-tx)',
        },
        warning: {
          bg: 'var(--warn-bg)',
          border: 'var(--warn-bd)',
          foreground: 'var(--warn-tx)',
        },
        success: {
          bg: 'var(--suc-bg)',
          border: 'var(--suc-bd)',
          foreground: 'var(--suc-tx)',
        },
        info: {
          bg: 'var(--info-bg)',
          border: 'var(--info-bd)',
          foreground: 'var(--info-tx)',
        },
        // Input/form nötrleri (kanonik hex).
        field: {
          DEFAULT: 'var(--in-bd)',
          hover: 'var(--in-bd-h)',
          readonly: 'var(--ro)',
          placeholder: 'var(--ph)',
        },
      },
      borderRadius: {
        lg: 'var(--radius)',
        md: 'calc(var(--radius) - 2px)',
        sm: 'calc(var(--radius) - 4px)',
        // Bölüm 24.3 — küçük rozetler (badge/tag) 6px; yüzeyler 8px.
        badge: '6px',
      },
      boxShadow: {
        // Bölüm 24 — tek gölge (yalnız yüzen yüzey).
        float: '0 1px 2px rgba(15,23,42,.06), 0 12px 28px rgba(15,23,42,.08)',
      },
      transitionTimingFunction: {
        swift: 'cubic-bezier(.2,0,0,1)',
      },
      keyframes: {
        'motion-pop': {
          from: { opacity: '0', transform: 'translateY(4px)' },
          to: { opacity: '1', transform: 'none' },
        },
      },
      animation: {
        'motion-pop': 'motion-pop 120ms cubic-bezier(.2,0,0,1)',
      },
    },
  },
  plugins: [],
};
