import { useWindowDimensions } from 'react-native';

import { breakpoints } from '@/theme/tokens';

export function useLayout() {
  const { width } = useWindowDimensions();
  return { width, isWide: width >= breakpoints.wide, isMedium: width >= breakpoints.medium };
}
