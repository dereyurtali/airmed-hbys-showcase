import { Building2, ClipboardList, FileSignature, ShieldCheck, UserCog } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { HubCardGrid, type HubCard } from '../components/admin/HubCardGrid';

// S16+ — Yönetici "Ayarlar" hub'ı: v0.2'den taşınan klinik konfigürasyon
// ekranlarını kart-grid olarak listeleyen dispatcher.

export function SettingsHubPage() {
  const { t } = useTranslation('common');

  // R5 (#727) — her kart kendi hedef route'unun yetkisiyle gate'li. Yetkisiz
  // rolde kart GİZLİ (App.tsx PermissionGuard'larıyla aynı anahtarlar). Örn.
  // Yönetici Asistanı yalnız yetkili olduğu kartları görür; "kilitli kart" yok.
  const cards: HubCard[] = [
    {
      to: '/admin/clinic-settings',
      icon: Building2,
      tint: 'rose',
      title: t('adminSettingsHub.cards.clinic.title'),
      description: t('adminSettingsHub.cards.clinic.description'),
      required: 'page:clinicSettings',
    },
    {
      to: '/admin/users',
      icon: UserCog,
      tint: 'sky',
      title: t('adminSettingsHub.cards.users.title'),
      description: t('adminSettingsHub.cards.users.description'),
      required: 'page:users',
    },
    {
      to: '/admin/permissions',
      icon: ShieldCheck,
      tint: 'amber',
      title: t('adminSettingsHub.cards.permissions.title'),
      description: t('adminSettingsHub.cards.permissions.description'),
      required: 'page:permissions',
    },
    {
      to: '/admin/consent-templates',
      icon: FileSignature,
      tint: 'violet',
      title: t('adminSettingsHub.cards.consentTemplates.title'),
      description: t('adminSettingsHub.cards.consentTemplates.description'),
      required: 'page:consentTemplates',
    },
    {
      to: '/admin/service-catalog',
      icon: ClipboardList,
      tint: 'emerald',
      title: t('adminSettingsHub.cards.serviceCatalog.title'),
      description: t('adminSettingsHub.cards.serviceCatalog.description'),
      required: 'page:serviceCatalog',
    },
  ];

  return (
    <HubCardGrid
      title={t('adminSettingsHub.title')}
      description={t('adminSettingsHub.description')}
      cards={cards}
    />
  );
}
