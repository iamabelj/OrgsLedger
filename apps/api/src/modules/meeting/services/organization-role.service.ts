// ============================================================
// OrgsLedger API — Organization Role Service
// Manages executive and committee roles, resolves participants
// ============================================================

import db from '../../../db';
import { logger } from '../../../logger';
import {
  OrganizationRole,
  OrganizationRoleMember,
  MeetingVisibilityType,
  ResolvedParticipants,
  OrganizationRoleType,
} from '../models';
import { AppError } from '../../../middleware/error-handler';

// ── Types ───────────────────────────────────────────────────

interface CreateRoleRequest {
  organizationId: string;
  roleName: string;
  roleType: OrganizationRoleType;
  description?: string;
}

interface AddMemberRequest {
  roleId: string;
  userId: string;
  addedBy: string;
}

// ── Service Class ───────────────────────────────────────────

class OrganizationRoleService {
  /**
   * Create a new organization role
   */
  async createRole(request: CreateRoleRequest): Promise<OrganizationRole> {
    try {
      const [row] = await db('organization_roles')
        .insert({
          organization_id: request.organizationId,
          role_name: request.roleName,
          role_type: request.roleType,
          description: request.description,
          is_active: true,
        })
        .returning('*');

      logger.info('[ORG_ROLE] Role created', {
        roleId: row.id,
        orgId: request.organizationId,
        roleName: request.roleName,
        roleType: request.roleType,
      });

      return this.roleFromRow(row);
    } catch (err: any) {
      if (err.code === '23505') { // Unique violation
        throw new AppError('Role with this name already exists', 409);
      }
      throw err;
    }
  }

  /**
   * Get role by ID
   */
  async getRoleById(roleId: string): Promise<OrganizationRole | null> {
    const row = await db('organization_roles')
      .where({ id: roleId })
      .first();

    return row ? this.roleFromRow(row) : null;
  }

  /**
   * Get all roles for an organization
   */
  async getOrganizationRoles(
    organizationId: string,
    roleType?: OrganizationRoleType
  ): Promise<OrganizationRole[]> {
    let query = db('organization_roles')
      .where({ organization_id: organizationId, is_active: true })
      .orderBy('role_name');

    if (roleType) {
      query = query.where('role_type', roleType);
    }

    const rows = await query;
    return rows.map((r: any) => this.roleFromRow(r));
  }

  /**
   * Add a member to a role
   */
  async addMember(request: AddMemberRequest): Promise<OrganizationRoleMember> {
    try {
      const [row] = await db('organization_role_members')
        .insert({
          role_id: request.roleId,
          user_id: request.userId,
          added_by: request.addedBy,
          is_active: true,
        })
        .returning('*');

      logger.info('[ORG_ROLE] Member added', {
        roleId: request.roleId,
        userId: request.userId,
      });

      return this.memberFromRow(row);
    } catch (err: any) {
      if (err.code === '23505') { // Unique violation
        throw new AppError('User is already a member of this role', 409);
      }
      throw err;
    }
  }

  /**
   * Remove a member from a role
   */
  async removeMember(roleId: string, userId: string): Promise<void> {
    await db('organization_role_members')
      .where({ role_id: roleId, user_id: userId })
      .update({ is_active: false });

    logger.info('[ORG_ROLE] Member removed', { roleId, userId });
  }

  /**
   * Get members of a specific role
   */
  async getRoleMembers(roleId: string): Promise<string[]> {
    const rows = await db('organization_role_members')
      .where({ role_id: roleId, is_active: true })
      .select('user_id');

    return rows.map((r: any) => r.user_id);
  }

  /**
   * Get all executive members in an organization
   */
  async getExecutiveMembers(organizationId: string): Promise<string[]> {
    const rows = await db('organization_role_members')
      .join('organization_roles', 'organization_roles.id', 'organization_role_members.role_id')
      .where({
        'organization_roles.organization_id': organizationId,
        'organization_roles.role_type': 'EXECUTIVE',
        'organization_roles.is_active': true,
        'organization_role_members.is_active': true,
      })
      .select('organization_role_members.user_id')
      .distinct();

    return rows.map((r: any) => r.user_id);
  }

  /**
   * Get all committee members for a specific committee role
   */
  async getCommitteeMembers(roleId: string): Promise<string[]> {
    return this.getRoleMembers(roleId);
  }

  /**
   * Get all members of an organization
   */
  async getAllOrgMembers(organizationId: string): Promise<string[]> {
    const rows = await db('memberships')
      .where({ organization_id: organizationId, is_active: true })
      .select('user_id');

    return rows.map((r: any) => r.user_id);
  }

  /**
   * Resolve participants based on visibility type.
   * This is the core function for determining who should be invited.
   */
  async resolveParticipants(
    organizationId: string,
    visibilityType: MeetingVisibilityType,
    options?: {
      committeeId?: string;
      customParticipants?: string[];
    }
  ): Promise<ResolvedParticipants> {
    const { committeeId, customParticipants } = options || {};

    switch (visibilityType) {
      case 'ALL_MEMBERS': {
        const userIds = await this.getAllOrgMembers(organizationId);
        return {
          userIds,
          count: userIds.length,
          visibilityType,
        };
      }

      case 'EXECUTIVES': {
        const userIds = await this.getExecutiveMembers(organizationId);
        return {
          userIds,
          count: userIds.length,
          visibilityType,
        };
      }

      case 'COMMITTEE': {
        if (!committeeId) {
          throw new AppError('Committee ID required for COMMITTEE visibility', 400);
        }

        // Verify committee exists and belongs to org
        const role = await this.getRoleById(committeeId);
        if (!role || role.organizationId !== organizationId) {
          throw new AppError('Committee not found in organization', 404);
        }
        if (role.roleType !== 'COMMITTEE') {
          throw new AppError('Specified role is not a committee', 400);
        }

        const userIds = await this.getCommitteeMembers(committeeId);
        return {
          userIds,
          count: userIds.length,
          visibilityType,
          sourceRoleId: committeeId,
        };
      }

      case 'CUSTOM': {
        if (!customParticipants || customParticipants.length === 0) {
          throw new AppError('Participant list required for CUSTOM visibility', 400);
        }

        // Validate all participants are org members
        const orgMembers = await this.getAllOrgMembers(organizationId);
        const orgMemberSet = new Set(orgMembers);
        const validParticipants = customParticipants.filter(id => orgMemberSet.has(id));

        if (validParticipants.length === 0) {
          throw new AppError('No valid organization members in participant list', 400);
        }

        return {
          userIds: validParticipants,
          count: validParticipants.length,
          visibilityType,
        };
      }

      default:
        throw new AppError(`Unknown visibility type: ${visibilityType}`, 400);
    }
  }

  /**
   * Check if a user belongs to a specific role type in an organization
   */
  async userHasRoleType(
    userId: string,
    organizationId: string,
    roleType: OrganizationRoleType
  ): Promise<boolean> {
    const row = await db('organization_role_members')
      .join('organization_roles', 'organization_roles.id', 'organization_role_members.role_id')
      .where({
        'organization_roles.organization_id': organizationId,
        'organization_roles.role_type': roleType,
        'organization_roles.is_active': true,
        'organization_role_members.user_id': userId,
        'organization_role_members.is_active': true,
      })
      .first();

    return !!row;
  }

  /**
   * Check if user is member of a specific role
   */
  async userIsRoleMember(userId: string, roleId: string): Promise<boolean> {
    const row = await db('organization_role_members')
      .where({
        role_id: roleId,
        user_id: userId,
        is_active: true,
      })
      .first();

    return !!row;
  }

  /**
   * Get all roles a user belongs to in an organization
   */
  async getUserRoles(userId: string, organizationId: string): Promise<OrganizationRole[]> {
    const rows = await db('organization_roles')
      .join('organization_role_members', 'organization_roles.id', 'organization_role_members.role_id')
      .where({
        'organization_roles.organization_id': organizationId,
        'organization_roles.is_active': true,
        'organization_role_members.user_id': userId,
        'organization_role_members.is_active': true,
      })
      .select('organization_roles.*');

    return rows.map((r: any) => this.roleFromRow(r));
  }

  // ── Row Converters ──────────────────────────────────────────

  private roleFromRow(row: any): OrganizationRole {
    return {
      id: row.id,
      organizationId: row.organization_id,
      roleName: row.role_name,
      roleType: row.role_type,
      description: row.description,
      isActive: row.is_active,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  private memberFromRow(row: any): OrganizationRoleMember {
    return {
      id: row.id,
      roleId: row.role_id,
      userId: row.user_id,
      addedAt: row.added_at,
      addedBy: row.added_by,
      isActive: row.is_active,
      createdAt: row.created_at,
    };
  }
}

// ── Singleton Export ────────────────────────────────────────

export const organizationRoleService = new OrganizationRoleService();
