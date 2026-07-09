import { BarChart3, CircleDollarSign, MessageSquare, ShieldAlert, TrendingUp } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { HubCardGrid, type HubCard } from '../components/admin/HubCardGrid';

// S16+ — Yönetici "Analiz" hub'ı: v0.2'den taşınan analitik/denetim
// ekranlarını kart-grid olarak listeleyen dispatcher. Sayfaların kendi
// iç permission guard'ı korunur — bu hub yalnız nav görünürlüğü için
// `page:adminAnalysis` ile guard'lanır.

export function AnalysisHubPage() {
  const { t } = useTranslation('common');

  const cards: HubCard[] = [
    {
      to: '/reports',
      icon: BarChart3,
      tint: 'sky',
      title: t('adminAnalysisHub.cards.reports.title'),
      description: t('adminAnalysisHub.cards.reports.description'),
    },
    {
      to: '/admin/hakedis',
      icon: CircleDollarSign,
      tint: 'emerald',
      title: t('adminAnalysisHub.cards.commission.title'),
      description: t('adminAnalysisHub.cards.commission.description'),
    },
    {
      to: '/admin/fraud',
      icon: ShieldAlert,
      tint: 'rose',
      title: t('adminAnalysisHub.cards.fraud.title'),
      description: t('adminAnalysisHub.cards.fraud.description'),
    },
    {
      to: '/leads',
      icon: TrendingUp,
      tint: 'blue',
      title: t('adminAnalysisHub.cards.leads.title'),
      description: t('adminAnalysisHub.cards.leads.description'),
    },
    {
      to: '/admin/messaging',
      icon: MessageSquare,
      tint: 'violet',
      title: t('adminAnalysisHub.cards.messaging.title'),
      description: t('adminAnalysisHub.cards.messaging.description'),
    },
  ];

  return (
    <HubCardGrid
      title={t('adminAnalysisHub.title')}
      description={t('adminAnalysisHub.description')}
      cards={cards}
    />
  );
}
