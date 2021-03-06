const { Pool } = require('pg');
const { nanoid } = require('nanoid');
const InvariantError = require('../../exceptions/InvariantError');
const NotFoundError = require('../../exceptions/NotFoundError');
const AuthorizationError = require('../../exceptions/AuthorizationError');

class PlaylistsService {
  constructor(collaborationService, cacheService) {
    this._pool = new Pool();
    this._collaborationService = collaborationService;
    this._cacheService = cacheService;
  }

  async addPlaylist({ name, owner }) {
    const id = `playlist-${nanoid(16)}`;
    const query = {
      text: 'INSERT INTO playlists VALUES($1, $2, $3) RETURNING id',
      values: [id, name, owner],
    };
    const result = await this._pool.query(query);
    if (!result.rows[0].id) {
      throw new InvariantError('Playlist gagal ditambahkan');
    }
    return result.rows[0].id;
  }

  async getPlaylists(owner) {
    const query = {
      text: `SELECT playlists.id, playlists.name, users.username FROM playlists
        LEFT JOIN collaborations ON collaborations.playlist_id = playlists.id
        LEFT JOIN users ON playlists.owner=users.id
        WHERE playlists.owner = $1 OR collaborations.user_id = $1
        GROUP BY playlists.id, users.id`,
      values: [owner],
    };
    const result = await this._pool.query(query);
    return result.rows;
  }

  async getPlaylistById(id) {
    const query = {
      text: 'SELECT * FROM playlists WHERE id = $1',
      values: [id],
    };
    const result = await this._pool.query(query);
    if (!result.rows.length) {
      throw new NotFoundError('Playlist tidak ditemukan');
    }
    return result.rows[0];
  }

  async editPlaylistById(id, { name }) {
    const query = {
      text: 'UPDATE playlists SET name = $1 WHERE id = $2 RETURNING id',
      values: [name, id],
    };
    const result = await this._pool.query(query);
    if (!result.rows.length) {
      throw new NotFoundError('Gagal memperbarui playlist. Id tidak ditemukan');
    }
  }

  async deletePlaylistById(id) {
    const query = {
      text: 'DELETE FROM playlists WHERE id = $1 RETURNING id',
      values: [id],
    };
    const result = await this._pool.query(query);
    if (!result.rows.length) {
      throw new NotFoundError('Playlist gagal dihapus. Id tidak ditemukan');
    }
  }

  async addSongToPlaylist({ songId, playlistId }) {
    const id = `playlistsong-${nanoid(16)}`;
    const query = {
      text: 'INSERT INTO playlistsongs VALUES($1, $2, $3) RETURNING id',
      values: [id, playlistId, songId],
    };
    const result = await this._pool.query(query);
    if (!result.rows[0].id) {
      throw new InvariantError('Lagu gagal ditambahkan ke playlist');
    }
    await this._cacheService.delete(`playlistsongs:${playlistId}`);
    return result.rows[0].id;
  }

  async getPlaylistSongs(playlistId) {
    try {
      const result = await this._cacheService.get(`playlistsongs:${playlistId}`);
      return JSON.parse(result);
    } catch (error) {
      const query = {
        text: `SELECT songs.id, songs.title, songs.performer
        FROM playlistsongs
        INNER JOIN songs ON playlistsongs.song_id=songs.id
        WHERE playlistsongs.playlist_id = $1;`,
        values: [playlistId],
      };
      const result = await this._pool.query(query);
      await this._cacheService.set(`playlistsongs:${playlistId}`, JSON.stringify(result.rows));
      return result.rows;
    }
  }

  async deletePlaylistSongsById({ songId, playlistId }) {
    const query = {
      text: `DELETE FROM playlistsongs 
      WHERE song_id = $1 AND
      playlist_id = $2
      RETURNING id`,
      values: [songId, playlistId],
    };
    const result = await this._pool.query(query);
    if (!result.rows.length) {
      throw new InvariantError('Lagu pada Playlist gagal dihapus');
    }
    await this._cacheService.delete(`playlistsongs:${playlistId}`);
    return result.rows;
  }

  async verifyPlaylistOwner(id, owner) {
    const query = {
      text: 'SELECT * FROM playlists WHERE id = $1',
      values: [id],
    };
    const result = await this._pool.query(query);
    if (!result.rows.length) {
      throw new NotFoundError('Playlist tidak ditemukan');
    }
    const note = result.rows[0];
    if (note.owner !== owner) {
      throw new AuthorizationError('Anda tidak berhak mengakses resource ini');
    }
  }

  async verifyPlaylistAccess(playlistId, userId) {
    try {
      await this.verifyPlaylistOwner(playlistId, userId);
    } catch (error) {
      if (error instanceof NotFoundError) {
        throw error;
      }
      try {
        await this._collaborationService.verifyCollaborator(playlistId, userId);
      } catch {
        throw error;
      }
    }
  }
}

module.exports = PlaylistsService;
