/** @type {import('tailwindcss').Config} */
// DNA Platform Admin — apps/web token sistemiyle hizalı (airmed-design Bölüm 24).
// Işık tema (kanon); platform admin iç araç olduğundan dark token seti taşınmaz.
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        border: 'var(--border)',
        input: 'var(--input)',
        ring: 'hsl(var(--ring))',
        canvas: 'var(--canvas)',
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
        // Bölüm 24.1 — durum (tint zemin + ince kenar + metin).
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
      },
      borderRadius: {
        lg: 'var(--radius)',
        md: 'calc(var(--radius) - 2px)',
        sm: 'calc(var(--radius) - 4px)',
        badge: '6px',
      },
      boxShadow: {
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
