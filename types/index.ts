export type CheckType = 'distance' | 'time' | 'orb' | 'treasure' | 'logic';

export interface ProgressCheck {
  id: string;
  name: string;
  type: CheckType;
  value: number;
  required: number;
  completed: boolean;
}
