/**
 * Private Group Chat System
 * Create groups with ID & password, real-time messaging
 */

class GroupChat {
  constructor() {
    this.db = firebase.database();
    this.groups = {};
    this.currentGroup = null;
  }

  /**
   * Create new group
   */
  async createGroup(groupName, password) {
    try {
      const groupId = this.generateGroupId();
      const hashedPassword = await this.hashPassword(password);

      const groupData = {
        id: groupId,
        name: groupName,
        password: hashedPassword,
        createdAt: Date.now(),
        members: [],
        messages: [],
      };

      await this.db.ref(`groups/${groupId}`).set(groupData);
      console.log('Group created:', groupId);
      return groupId;
    } catch (error) {
      console.error('Failed to create group:', error);
      throw error;
    }
  }

  /**
   * Join group with password
   */
  async joinGroup(groupId, password, userName) {
    try {
      const groupSnapshot = await this.db.ref(`groups/${groupId}`).once('value');
      const group = groupSnapshot.val();

      if (!group) throw new Error('Group not found');

      const isPasswordValid = await this.verifyPassword(password, group.password);
      if (!isPasswordValid) throw new Error('Invalid password');

      const member = {
        id: this.generateMemberId(),
        name: userName,
        joinedAt: Date.now(),
      };

      await this.db.ref(`groups/${groupId}/members`).push(member);
      this.currentGroup = groupId;
      console.log('Joined group:', groupId);
      return group;
    } catch (error) {
      console.error('Failed to join group:', error);
      throw error;
    }
  }

  /**
   * Leave group
   */
  async leaveGroup(groupId, memberId) {
    try {
      await this.db.ref(`groups/${groupId}/members/${memberId}`).remove();
      if (this.currentGroup === groupId) {
        this.currentGroup = null;
      }
      console.log('Left group:', groupId);
    } catch (error) {
      console.error('Failed to leave group:', error);
      throw error;
    }
  }

  /**
   * Send message
   */
  async sendMessage(groupId, message, senderName) {
    try {
      const msgData = {
        id: this.generateMessageId(),
        text: message,
        sender: senderName,
        timestamp: Date.now(),
      };

      await this.db.ref(`groups/${groupId}/messages`).push(msgData);
      console.log('Message sent to group:', groupId);
      return msgData;
    } catch (error) {
      console.error('Failed to send message:', error);
      throw error;
    }
  }

  /**
   * Listen for messages in real-time
   */
  onMessageReceived(groupId, callback) {
    this.db.ref(`groups/${groupId}/messages`).on('child_added', (snapshot) => {
      const message = snapshot.val();
      callback(message);
    });
  }

  /**
   * Get all messages
   */
  async getMessages(groupId) {
    try {
      const snapshot = await this.db.ref(`groups/${groupId}/messages`).once('value');
      const messages = [];
      snapshot.forEach((child) => {
        messages.push(child.val());
      });
      return messages.sort((a, b) => a.timestamp - b.timestamp);
    } catch (error) {
      console.error('Failed to get messages:', error);
      return [];
    }
  }

  /**
   * Get group members
   */
  async getMembers(groupId) {
    try {
      const snapshot = await this.db.ref(`groups/${groupId}/members`).once('value');
      const members = [];
      snapshot.forEach((child) => {
        members.push(child.val());
      });
      return members;
    } catch (error) {
      console.error('Failed to get members:', error);
      return [];
    }
  }

  /**
   * Delete group (creator only)
   */
  async deleteGroup(groupId) {
    try {
      await this.db.ref(`groups/${groupId}`).remove();
      console.log('Group deleted:', groupId);
    } catch (error) {
      console.error('Failed to delete group:', error);
      throw error;
    }
  }

  /**
   * Hash password using SHA-256
   */
  async hashPassword(password) {
    const encoder = new TextEncoder();
    const data = encoder.encode(password);
    const hashBuffer = await crypto.subtle.digest('SHA-256', data);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
  }

  /**
   * Verify password
   */
  async verifyPassword(password, hash) {
    const passwordHash = await this.hashPassword(password);
    return passwordHash === hash;
  }

  /**
   * Generate unique group ID
   */
  generateGroupId() {
    return 'grp_' + Math.random().toString(36).substr(2, 9);
  }

  /**
   * Generate unique member ID
   */
  generateMemberId() {
    return 'mem_' + Math.random().toString(36).substr(2, 9);
  }

  /**
   * Generate unique message ID
   */
  generateMessageId() {
    return 'msg_' + Math.random().toString(36).substr(2, 9);
  }
}

const groupChat = new GroupChat();
