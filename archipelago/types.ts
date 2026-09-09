/**
 * Archipelago Network Protocol Specification & Trekipelago Custom World Mappings
 */

// Unique Base ID for Trekipelago items and locations in the Archipelago ecosystem
export const TREKIPELAGO_BASE_ITEM_ID = 7730000;
export const TREKIPELAGO_BASE_DISTANCE_LOC_ID = 7740000;
export const TREKIPELAGO_BASE_ORB_LOC_ID = 7750000;

export enum ItemClassification {
  Progression = 1,
  Useful = 2,
  Trap = 4,
  Filler = 0,
}

export interface ArchipelagoItemDefinition {
  code: number;
  name: string;
  classification: ItemClassification;
  gameType: string;
}

export const TREKIPELAGO_ITEM_TABLE: Record<string, ArchipelagoItemDefinition> = {
  unlock_background: {
    code: TREKIPELAGO_BASE_ITEM_ID + 1,
    name: 'Background Tracking Unlocked',
    classification: ItemClassification.Progression,
    gameType: 'unlock_background',
  },
  passive_collector: {
    code: TREKIPELAGO_BASE_ITEM_ID + 2,
    name: 'Progressive Passive Collector',
    classification: ItemClassification.Progression,
    gameType: 'passive_collector',
  },
  progressive_speed: {
    code: TREKIPELAGO_BASE_ITEM_ID + 3,
    name: 'Progressive Speed Limit',
    classification: ItemClassification.Progression,
    gameType: 'progressive_speed',
  },
  speed_up: {
    code: TREKIPELAGO_BASE_ITEM_ID + 4,
    name: 'Speed Boost (+50%)',
    classification: ItemClassification.Useful,
    gameType: 'speed_up',
  },
  boost_distance_2x: {
    code: TREKIPELAGO_BASE_ITEM_ID + 5,
    name: 'Double Distance (2x)',
    classification: ItemClassification.Useful,
    gameType: 'boost_distance_2x',
  },
  boost_drop_2x: {
    code: TREKIPELAGO_BASE_ITEM_ID + 6,
    name: 'Double Orb Drop (2x)',
    classification: ItemClassification.Useful,
    gameType: 'boost_drop_2x',
  },
  trap_blind: {
    code: TREKIPELAGO_BASE_ITEM_ID + 7,
    name: 'Map Blind Trap',
    classification: ItemClassification.Trap,
    gameType: 'trap_blind',
  },
  trap_distance: {
    code: TREKIPELAGO_BASE_ITEM_ID + 8,
    name: 'Lost Distance Trap (-500m)',
    classification: ItemClassification.Trap,
    gameType: 'trap_distance',
  },
};

export interface NetworkItem {
  item: number;
  location: number;
  player: number;
  flags: number;
}

export interface NetworkSlot {
  name: string;
  game: string;
  type: number;
  group_members?: number[];
}

export interface JSONMessagePart {
  type?: 'player_id' | 'item_id' | 'location_id' | 'color' | 'text';
  text?: string;
  color?: string;
  flags?: number;
  player?: number;
}

export type ArchipelagoConnectionStatus =
  | 'disconnected'
  | 'connecting'
  | 'connected'
  | 'authenticated'
  | 'error';

export interface TrekipelagoSlotData {
  reward_distance_interval?: number;
  max_distance_meters?: number;
  orbs_per_reward?: number;
  max_orbs_goal?: number;
  goal_type?: 'distance' | 'orbs' | 'both';
  region_radius_meters?: number;
  trap_chance?: number;
}

// Inbound packets
export interface RoomInfoPacket {
  cmd: 'RoomInfo';
  version: { major: number; minor: number; build: number };
  generator_version: { major: number; minor: number; build: number };
  tags: string[];
  password: boolean;
  permissions: Record<string, number>;
  hint_cost: number;
  location_check_points: number;
  games: string[];
  datapackage_checksums: Record<string, string>;
  seed_name: string;
  time: number;
}

export interface ConnectionRefusedPacket {
  cmd: 'ConnectionRefused';
  errors: string[];
}

export interface ConnectedPacket {
  cmd: 'Connected';
  team: number;
  slot: number;
  players: NetworkSlot[];
  missing_locations: number[];
  checked_locations: number[];
  slot_data: TrekipelagoSlotData;
  slot_info: Record<string, NetworkSlot>;
}

export interface ReceivedItemsPacket {
  cmd: 'ReceivedItems';
  index: number;
  items: NetworkItem[];
}

export interface LocationInfoPacket {
  cmd: 'LocationInfo';
  locations: NetworkItem[];
}

export interface RoomUpdatePacket {
  cmd: 'RoomUpdate';
  checked_locations?: number[];
  missing_locations?: number[];
}

export interface PrintJSONPacket {
  cmd: 'PrintJSON';
  data: JSONMessagePart[];
  type?: string;
  receiving?: number;
  item?: NetworkItem;
  found?: boolean;
}

export type ArchipelagoServerPacket =
  | RoomInfoPacket
  | ConnectionRefusedPacket
  | ConnectedPacket
  | ReceivedItemsPacket
  | LocationInfoPacket
  | RoomUpdatePacket
  | PrintJSONPacket;

// Outbound packets
export interface ConnectPacket {
  cmd: 'Connect';
  password?: string;
  game: string;
  name: string;
  version: { major: number; minor: number; build: number; class: 'Version' };
  tags: string[];
  items_handling: number; // 7 = receive items from starting, own world, and other worlds
  uuid: string;
}

export interface LocationChecksPacket {
  cmd: 'LocationChecks';
  locations: number[];
}

export interface StatusUpdatePacket {
  cmd: 'StatusUpdate';
  status: number; // 30 = client ready, 40 = goal completed
}

export interface SayPacket {
  cmd: 'Say';
  text: string;
}

export type ArchipelagoClientPacket =
  | ConnectPacket
  | LocationChecksPacket
  | StatusUpdatePacket
  | SayPacket;
