// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Bulat Ruslanovich

export interface ArtistRef {
  id: string;
  name: string;
}

export interface TrackCues {
  audioStart: number;
  audioEnd: number;
  outroStart: number;
  bpm?: number | null;
}

export interface MusicalKey {
  tonic: string;
  minor: boolean;
  camelot: string;
}

export interface TrackLoudness {
  lufs: number;
  truePeak: number;
  range?: number | null;
}

export interface Track {
  id: string;
  title: string;
  artistId: string;
  artistName: string;
  artists?: ArtistRef[] | null;
  albumId?: string | null;
  albumTitle?: string | null;
  genreName?: string | null;
  trackNumber?: number | null;
  discNumber?: number | null;
  year?: number | null;
  durationSeconds: number;
  originalFileName: string;
  isFavorite: boolean;
  hasCover: boolean;
  hasLyrics: boolean;
  createdAt: string;
  codec?: string | null;
  bitrateKbps?: number | null;
  sampleRateHz?: number | null;
  bitsPerSample?: number | null;
  cues?: TrackCues | null;
  key?: MusicalKey | null;
  loudness?: TrackLoudness | null;
}

export interface DuplicateGroup {
  tracks: Track[];
  similarity?: number | null;
}

export interface DuplicateReport {
  groups: DuplicateGroup[];
  comparedTracks: number;
  totalTracks: number;
}

export interface MapPoint {
  id: string;
  x: number;
  y: number;
  title: string;
  artist: string;
  albumId?: string | null;
  hasCover: boolean;
  genre?: string | null;
  plays: number;
}

export interface LibraryMap {
  points: MapPoint[];
  totalTracks: number;
}

export interface Artist {
  id: string;
  name: string;
  albumCount: number;
  trackCount: number;
  hasImage: boolean;
}

export type ArtistDetail = Omit<Artist, "albumCount" | "trackCount"> & {
  albums: Album[];
  tracks: Paged<Track>;
};

export interface Album {
  id: string;
  title: string;
  artistId: string;
  artistName: string;
  year?: number | null;
  trackCount: number;
  durationSeconds: number;
  hasCover: boolean;
  createdAt: string;
}

export type AlbumDetail = Omit<Album, "trackCount" | "createdAt"> & { tracks: Track[] };

export interface Genre {
  id: string;
  name: string;
  trackCount: number;
  coverAlbumIds: string[];
}

export interface Playlist {
  id: string;
  name: string;
  description?: string | null;
  isPublic: boolean;
  ownerId: string;
  ownerName: string;
  trackCount: number;
  durationSeconds: number;
  hasCover: boolean;
  coverTrackId?: string | null;
  createdAt: string;
  updatedAt: string;
}

export type PlaylistDetail = Omit<Playlist, "trackCount"> & { tracks: Track[] };

export interface SearchTopResult {
  kind: "Artist" | "Album" | "Track" | "Genre";
  artist?: Artist | null;
  album?: Album | null;
  track?: Track | null;
  genre?: Genre | null;
}

export interface SearchResults {
  artists: Artist[];
  albums: Album[];
  tracks: Track[];
  genres: Genre[];
  top?: SearchTopResult | null;
}

export interface HistoryEntry {
  id: string;
  track: Track;
  playedAt: string;
  playbackPosition: number;
}

export interface LibraryStats {
  trackCount: number;
  albumCount: number;
  totalDurationSeconds: number;
  totalBytes: number;
  freeBytes: number;
  favoriteCount: number;
}

export interface LibraryOverview {
  stats: LibraryStats;
  recentTracks: Track[];
  recentAlbums: Album[];
  recentArtists: Artist[];
  topGenres: Genre[];
}

export interface Paged<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

export type PageParams = { page?: number; pageSize?: number };

export type TrackSort = "Title" | "Recent" | "Artist" | "Album" | "Bpm" | "Key" | "Loudness";

export type TrackFilter = {
  bpmMin?: number;
  bpmMax?: number;
  key?: string;
};

export interface LyricLine {
  at: number;
  text: string;
}

export interface Lyrics {
  trackId: string;
  plain: string;
  lines: LyricLine[];
  source: "Embedded" | "Manual" | "Provider";
}

export interface HomeBlock {
  key: string;
  baseKey: string;
  layout: "Shelf" | "Hero" | "Tile" | "QuickTiles" | "Grid" | "Chart" | "Circles";
  zone: "Lead" | "Quick" | "Browse";
  reason?: RecommendationReason | null;
  tracks?: Track[] | null;
  albums?: Album[] | null;
  artists?: Artist[] | null;
  playlists?: Playlist[] | null;
  totalCount?: number | null;
}

export interface HomeFeed {
  blocks: HomeBlock[];
  stats: LibraryStats;
}

export type HomeMixSlug = "daily" | "new" | "top";

export interface HomeMix {
  tracks: Track[];
}

export interface RecommendationReason {
  kind: string;
  subject?: string | null;
  subjectId?: string | null;
}

export interface QueueSignals {
  explore: boolean;
}

export interface RecommendedTrack {
  track: Track;
  reason: RecommendationReason;
  signals?: QueueSignals | null;
}

export interface Recap {
  year: number;
  month: number;
  listenedSeconds: number;
  plays: number;
  distinctTracks: number;
  distinctArtists: number;
  previousListenedSeconds?: number | null;
  topTracks: { track: Track; plays: number }[];
  topArtists: { artist: Artist; plays: number; listenedSeconds: number }[];
  topGenre?: string | null;
  daySeconds: number[];
  hourSeconds: number[];
  soundOfMonth?: Track | null;
  newArtists?: number | null;
  newArtistPicks: Artist[];
}

export interface SourceStats {
  source?: string | null;
  recommended: boolean;
  impressions: number;
  starts: number;
  completed: number;
  skipped: number;
  skippedEarly: number;
  liked: number;
  listenedSeconds: number;
}

export interface RadioImpressionStats {
  explore: boolean;
  shown: number;
  finished: number;
  partial: number;
  earlySkips: number;
  unplayed: number;
  pending: number;
}

export interface RecommendationStats {
  days: number;
  listenedSeconds: number;
  recommendedSeconds: number;
  sources: SourceStats[];
  radio?: RadioImpressionStats[];
  behavior?: ListeningStats[];
}

export interface ListeningStats {
  source: string;
  earlySkips: number;
  partial: number;
  nearComplete: number;
  unrated: number;
}

export interface AccountSession {
  id: string;
  deviceName?: string | null;
  userAgent?: string | null;
  ip?: string | null;
  longLived: boolean;
  signedInAt: string;
  lastUsedAt: string;
  current: boolean;
}

export interface SignInRecord {
  method: "password" | "invitation";
  success: boolean;
  reason?: string | null;
  ip?: string | null;
  userAgent?: string | null;
  deviceName?: string | null;
  occurredAt: string;
}

export interface Invitation {
  id: string;
  isAdmin: boolean;
  createdBy?: string | null;
  createdAt: string;
  expiresAt: string;
  usedAt?: string | null;
  usedBy?: string | null;
}

export interface CreatedInvitation {
  id: string;
  token: string;
  expiresAt: string;
}

export type RadioFocus = "closer" | "balanced" | "wider";

export type TasteRuleAction = "block" | "downrank" | "cooldown";

export type TasteRuleTarget = "track" | "artist" | "album" | "genre";

export interface TasteRule {
  id: string;
  action: TasteRuleAction;
  targetType: TasteRuleTarget;
  targetId: string;
  name: string;
  artistName?: string | null;
  until?: string | null;
  createdAt: string;
}

export interface RadioBatch {
  tracks: RecommendedTrack[];
  seedTrackId?: string | null;
}

export interface PlayingElsewhere {
  deviceId: string;
  deviceName: string;
  track: Track;
  positionSeconds: number;
  isPlaying: boolean;
  reportedAt: string;
}

export interface PlaybackHandoff {
  deviceId: string;
  deviceName: string;
  tracks: Track[];
  index: number;
  positionSeconds: number;
  shuffle: boolean;
  repeat: "off" | "all" | "one";
}

export interface PlaybackStateReport {
  deviceId: string;
  deviceName: string;
  trackIds: string[];
  index: number;
  positionSeconds: number;
  isPlaying: boolean;
  shuffle: boolean;
  repeat: "off" | "all" | "one";
}

export interface User {
  id: string;
  username: string;
  isAdmin: boolean;
}

export interface AdminUser extends User {
  isActive: boolean;
  createdAt: string;
}

export interface ClientConfig {
  maxUploadBytes: number;
  maxImageUploadBytes: number;
  accessTokenMinutes: number;
  recommendationsEnabled?: boolean;
}

export type AudioQuality = "Low" | "Normal" | "Original";

export interface UserSettings {
  quality: AudioQuality;
  timeZone: string;
}

export interface UploadResult {
  uploaded: Track[];
  failed: { fileName: string; reason: string }[];
}

export interface UploadProgress {
  percent: number;
  fileIndex: number;
  fileCount: number;
  fileName: string;
}

export interface BulkDeleteResult {
  deleted: number;
  missing: string[];
}

export interface UploadProbeFile {
  fileName: string;
  contentHash?: string;
  title?: string;
  artist?: string;
}

export type UploadProbeVerdict = "New" | "Duplicate" | "Upgrade";

export type UploadProbeBasis = "None" | "Tags" | "Hash" | "HashAndTags";

export interface UploadProbeResult {
  files: {
    fileName: string;
    verdict: UploadProbeVerdict;
    basis: UploadProbeBasis;
    match?: Track;
  }[];
}

export interface YandexTrack {
  id: string;
  title: string;
  artist: string;
  album?: string | null;
  coverUrl?: string | null;
  durationSeconds: number;
  available: boolean;
  inLibrary: boolean;
}

export interface YandexAlbum {
  id: string;
  title: string;
  artist: string;
  year?: number | null;
  trackCount?: number | null;
  coverUrl?: string | null;
}

export interface YandexSearch {
  tracks: YandexTrack[];
  albums: YandexAlbum[];
}

export type YandexImportKind = "Likes" | "Album" | "Track";

export type YandexImportStatus = "Queued" | "Running" | "Finished" | "Failed" | "Cancelled";

export interface LibraryScanProblem {
  path: string;
  reason: string;
}

export interface LibraryScan {
  configured: boolean;
  running: boolean;
  startedAt?: string | null;
  finishedAt?: string | null;
  files: number;
  checked: number;
  added: number;
  moved: number;
  renamed: number;
  exported: number;
  updated: number;
  skipped: number;
  failed: number;
  missing: number;
  removed: number;
  unsupported: number;
  problems: LibraryScanProblem[];
}

export interface YandexImport {
  id: string;
  kind: YandexImportKind;
  title?: string | null;
  status: YandexImportStatus;
  error?: string | null;
  total: number;
  done: number;
  added: number;
  skipped: number;
  current?: string | null;
  failures: { title: string; reason: string }[];
  createdAt: string;
}

export type LibraryKind = "album" | "artist" | "playlist";
export interface LibraryItem {
  kind: LibraryKind;
  id: string;
  title: string;
  subtitle: string;
  hasImage: boolean;
  coverTrackId: string | null;
  savedAt: string;
  folderId: string | null;
}

export interface LibraryFolder {
  id: string;
  name: string;
  parentId: string | null;
  createdAt: string;
}
export type LibraryChange =
  | { operation: "create"; id: string; name: string; folderId: string | null }
  | { operation: "rename"; id: string; name: string }
  | { operation: "moveFolder"; id: string; folderId: string | null }
  | { operation: "delete"; id: string }
  | { operation: "moveItem"; id: string; kind: LibraryKind; folderId: string | null };
