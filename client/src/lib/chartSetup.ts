/**
 * Chart.js 글로벌 설정 (다크모드 + 한글)
 */
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  BarElement,
  Title,
  Tooltip,
  Legend,
  Filler,
} from 'chart.js';

ChartJS.register(
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  BarElement,
  Title,
  Tooltip,
  Legend,
  Filler
);

// 다크모드 기본 색상
ChartJS.defaults.color = '#b0bec5';
ChartJS.defaults.borderColor = '#1e2849';
ChartJS.defaults.font.family = 'Pretendard, Inter, system-ui, sans-serif';

export const CHART_COLORS = {
  cyan: '#00d9ff',
  gold: '#ffd700',
  pink: '#ff6b9d',
  success: '#00c853',
  warning: '#ffb300',
  danger: '#ff1744',
  grid: '#2a3554',
  text: '#b0bec5',
};
