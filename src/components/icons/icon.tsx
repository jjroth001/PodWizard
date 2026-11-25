import Svg, { Path } from 'react-native-svg';

import { PHOSPHOR, type IconName } from './phosphor-paths';

export type { IconName } from './phosphor-paths';

type IconProps = {
  name: IconName;
  size?: number;
  color: string;
  /** The soft background shape; off for small inline icons. */
  duotone?: boolean;
};

/**
 * Icons that are a bare mark with nothing to tint. Phosphor's two-tone versions of these put a
 * plain box behind the mark, which showed as a faint square around every plus and cross, so
 * they're always drawn as the mark alone.
 */
const NO_BACKDROP: ReadonlySet<IconName> = new Set<IconName>([
  'plus',
  'x',
  'check',
  'dots-three-vertical',
  'dots-six-vertical',
]);

/** A Phosphor icon (MIT), duotone or filled, in any colour. */
export function Icon({ name, size = 24, color, duotone = true }: IconProps) {
  const { duo, solid } = PHOSPHOR[name];
  return (
    <Svg width={size} height={size} viewBox="0 0 256 256" accessible={false}>
      {duotone &&
        !NO_BACKDROP.has(name) &&
        duo.map((d) => <Path key={d} d={d} fill={color} opacity={0.2} />)}
      {solid.map((d) => (
        <Path key={d} d={d} fill={color} />
      ))}
    </Svg>
  );
}
