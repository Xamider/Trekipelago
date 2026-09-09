import {
  ArchipelagoClientPacket,
  ArchipelagoConnectionStatus,
  ArchipelagoServerPacket,
  ConnectedPacket,
  NetworkItem,
  ReceivedItemsPacket,
  RoomInfoPacket,
  TrekipelagoSlotData,
} from './types';
import { repository } from '../storage/database';
import type { ArchipelagoSaveState } from '../storage/repository';

export interface ArchipelagoClientOptions {
  host: string;
  port: number | string;
  slotName: string;
  password?: string;
  tags?: string[];
}

export type StatusListener = (status: ArchipelagoConnectionStatus, details?: string) => void;
export type ItemListener = (item: NetworkItem, index: number) => void;
export type LogListener = (message: string, isError?: boolean) => void;

export class ArchipelagoClient {
  private socket: WebSocket | null = null;
  private status: ArchipelagoConnectionStatus = 'disconnected';
  private host = '';
  private port = '';
  private slotName = '';
  private password = '';
  private slotNumber: number | null = null;
  private teamNumber: number | null = null;
  private roomSeed = '';
  private slotData: TrekipelagoSlotData = {};
  private checkedLocations: Set<number> = new Set();
  private receivedItemIndex = 0;

  private statusListeners: Set<StatusListener> = new Set();
  private itemListeners: Set<ItemListener> = new Set();
  private logListeners: Set<LogListener> = new Set();

  public async loadPersistedState(): Promise<ArchipelagoSaveState | null> {
    try {
      const state = await repository.readArchipelagoState();
      if (state) {
        this.host = state.config.host;
        this.port = state.config.port;
        this.slotName = state.config.slotName;
        this.password = state.config.password ?? '';
        this.slotNumber = state.slotNumber ?? null;
        this.teamNumber = state.teamNumber ?? null;
        this.roomSeed = state.roomSeed ?? '';
        this.slotData = (state.slotData as TrekipelagoSlotData) ?? {};
        this.checkedLocations = new Set(state.checkedLocations ?? []);
        this.receivedItemIndex = state.receivedItemIndex ?? 0;
      }
      return state;
    } catch {
      return null;
    }
  }

  public getStatus(): ArchipelagoConnectionStatus {
    return this.status;
  }

  public getSlotData(): TrekipelagoSlotData {
    return this.slotData;
  }

  public getCheckedLocations(): Set<number> {
    return new Set(this.checkedLocations);
  }

  public onStatusChange(listener: StatusListener): () => void {
    this.statusListeners.add(listener);
    return () => this.statusListeners.delete(listener);
  }

  public onItemReceived(listener: ItemListener): () => void {
    this.itemListeners.add(listener);
    return () => this.itemListeners.delete(listener);
  }

  public onLog(listener: LogListener): () => void {
    this.logListeners.add(listener);
    return () => this.logListeners.delete(listener);
  }

  private setStatus(status: ArchipelagoConnectionStatus, details?: string) {
    this.status = status;
    for (const listener of this.statusListeners) {
      try {
        listener(status, details);
      } catch {}
    }
  }

  private log(message: string, isError = false) {
    for (const listener of this.logListeners) {
      try {
        listener(message, isError);
      } catch {}
    }
  }

  public connect(options: ArchipelagoClientOptions): void {
    this.disconnect();

    this.host = options.host.trim();
    this.port = String(options.port).trim();
    this.slotName = options.slotName.trim();
    this.password = options.password ?? '';

    // Persist configuration to database so it stays saved across app launches
    void repository.saveArchipelagoConfig({
      host: this.host,
      port: this.port,
      slotName: this.slotName,
      password: this.password || undefined,
    }).catch(() => undefined);

    const cleanHost = this.host.replace(/^wss?:\/\//, '');
    const isSecure = cleanHost.includes('archipelago.gg');
    const protocol = isSecure ? 'wss' : 'ws';
    const url = this.port ? `${protocol}://${cleanHost}:${this.port}` : `${protocol}://${cleanHost}`;

    this.setStatus('connecting');
    this.log(`Connecting to ${url}...`);

    try {
      this.socket = new WebSocket(url);

      this.socket.onopen = () => {
        this.setStatus('connected');
        this.log('Connected to Archipelago server. Awaiting RoomInfo handshake...');
      };

      this.socket.onmessage = (event: WebSocketMessageEvent) => {
        try {
          const raw = String(event.data);
          const packets = JSON.parse(raw) as ArchipelagoServerPacket[];
          if (!Array.isArray(packets)) return;
          for (const packet of packets) {
            this.handlePacket(packet);
          }
        } catch (err) {
          this.log(`Error decoding server message: ${String(err)}`, true);
        }
      };

      this.socket.onerror = (error) => {
        this.log(`WebSocket error: ${JSON.stringify(error)}`, true);
        this.setStatus('error', 'Socket connection error');
      };

      this.socket.onclose = (event) => {
        const reason = event.reason ? ` (${event.reason})` : '';
        this.log(`Disconnected from server [code ${event.code}]${reason}`);
        this.setStatus('disconnected', event.reason || undefined);
        this.socket = null;
      };
    } catch (err) {
      this.setStatus('error', String(err));
      this.log(`Failed to initiate connection: ${String(err)}`, true);
    }
  }

  public disconnect(): void {
    if (this.socket) {
      try {
        this.socket.close();
      } catch {}
      this.socket = null;
    }
    this.setStatus('disconnected');
  }

  public sendLocationCheck(locationId: number): void {
    this.sendLocationChecks([locationId]);
  }

  public sendLocationChecks(locationIds: number[]): void {
    const newChecks = locationIds.filter(id => !this.checkedLocations.has(id));
    if (newChecks.length === 0) return;

    for (const id of newChecks) {
      this.checkedLocations.add(id);
    }

    // Save checks into SQLite database
    void repository.recordArchipelagoLocationChecks(newChecks).catch(() => undefined);

    this.sendPacket({
      cmd: 'LocationChecks',
      locations: newChecks,
    });
    this.log(`Sent ${newChecks.length} location check(s) to server.`);
  }

  public sendGoalAchieved(): void {
    this.sendPacket({
      cmd: 'StatusUpdate',
      status: 40, // CLIENT_GOAL
    });
    void repository.updateArchipelagoState(current => (current ? { ...current, goalReached: true, updatedAt: Date.now() } : current)).catch(() => undefined);
    this.log('Notified server: Goal completed! 🏆');
  }

  public sendChatMessage(text: string): void {
    this.sendPacket({
      cmd: 'Say',
      text,
    });
  }

  private sendPacket(packet: ArchipelagoClientPacket): void {
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) {
      this.log('Cannot send message: WebSocket is not open', true);
      return;
    }
    try {
      this.socket.send(JSON.stringify([packet]));
    } catch (err) {
      this.log(`Failed to send packet: ${String(err)}`, true);
    }
  }

  private handlePacket(packet: ArchipelagoServerPacket): void {
    switch (packet.cmd) {
      case 'RoomInfo':
        this.handleRoomInfo(packet);
        break;

      case 'ConnectionRefused':
        this.setStatus('error', packet.errors.join(', '));
        this.log(`Connection refused: ${packet.errors.join(', ')}`, true);
        break;

      case 'Connected':
        this.handleConnected(packet);
        break;

      case 'ReceivedItems':
        this.handleReceivedItems(packet);
        break;

      case 'RoomUpdate':
        if (packet.checked_locations) {
          for (const loc of packet.checked_locations) {
            this.checkedLocations.add(loc);
          }
          void repository.recordArchipelagoLocationChecks(packet.checked_locations).catch(() => undefined);
        }
        break;

      case 'PrintJSON':
        if (packet.data) {
          const text = packet.data.map(part => part.text || '').join('');
          this.log(`[AP] ${text}`);
        }
        break;

      default:
        break;
    }
  }

  private handleRoomInfo(packet: RoomInfoPacket): void {
    this.roomSeed = packet.seed_name;
    this.log(`Room info received. Seed: ${packet.seed_name}. Authenticating slot "${this.slotName}"...`);
    this.sendPacket({
      cmd: 'Connect',
      password: this.password,
      game: 'Trekipelago',
      name: this.slotName,
      version: { major: 0, minor: 4, build: 6, class: 'Version' },
      tags: ['AP', 'DeathLink'],
      items_handling: 7, // Receive all items
      uuid: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`,
    });
  }

  private handleConnected(packet: ConnectedPacket): void {
    this.slotNumber = packet.slot;
    this.teamNumber = packet.team;
    this.slotData = packet.slot_data || {};
    this.checkedLocations = new Set(packet.checked_locations || []);
    this.setStatus('authenticated');

    // Persist full connected snapshot to SQLite database
    void repository.updateArchipelagoState(current => {
      return {
        config: {
          host: this.host,
          port: this.port,
          slotName: this.slotName,
          password: this.password || undefined,
        },
        roomSeed: this.roomSeed,
        slotNumber: packet.slot,
        teamNumber: packet.team,
        slotData: packet.slot_data as Record<string, unknown>,
        checkedLocations: packet.checked_locations || [],
        receivedItems: current?.receivedItems ?? [],
        receivedItemIndex: current?.receivedItemIndex ?? 0,
        goalReached: current?.goalReached ?? false,
        updatedAt: Date.now(),
      };
    }).catch(() => undefined);

    this.log(`Successfully authenticated as slot ${packet.slot} (Team ${packet.team})!`);
    if (packet.slot_data) {
      this.log(`Slot data: ${JSON.stringify(packet.slot_data)}`);
    }
  }

  private handleReceivedItems(packet: ReceivedItemsPacket): void {
    const newItems: NetworkItem[] = [];
    for (let i = 0; i < packet.items.length; i++) {
      const item = packet.items[i];
      const itemIndex = packet.index + i;
      if (itemIndex >= this.receivedItemIndex) {
        this.receivedItemIndex = itemIndex + 1;
        newItems.push(item);
        for (const listener of this.itemListeners) {
          try {
            listener(item, itemIndex);
          } catch {}
        }
      }
    }

    if (newItems.length > 0) {
      void repository.recordArchipelagoReceivedItems(newItems, this.receivedItemIndex).catch(() => undefined);
      this.log(`Received ${newItems.length} item(s) from Archipelago (now at index ${this.receivedItemIndex}).`);
    }
  }
}

// Global singleton instance for app-wide Archipelago connectivity
export const archipelagoClient = new ArchipelagoClient();
