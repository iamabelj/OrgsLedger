"use strict";
// ============================================================
// OrgsLedger API — Organization Role Service
// Manages executive and committee roles, resolves participants
// ============================================================
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.organizationRoleService = void 0;
const db_1 = __importDefault(require("../../../db"));
const logger_1 = require("../../../logger");
const error_handler_1 = require("../../../middleware/error-handler");
// ── Service Class ───────────────────────────────────────────
class OrganizationRoleService {
    /**
     * Create a new organization role
     */
    async createRole(request) {
        try {
            const [row] = await (0, db_1.default)('organization_roles')
                .insert({
                organization_id: request.organizationId,
                role_name: request.roleName,
                role_type: request.roleType,
                description: request.description,
                is_active: true,
            })
                .returning('*');
            logger_1.logger.info('[ORG_ROLE] Role created', {
                roleId: row.id,
                orgId: request.organizationId,
                roleName: request.roleName,
                roleType: request.roleType,
            });
            return this.roleFromRow(row);
        }
        catch (err) {
            if (err.code === '23505') { // Unique violation
                throw new error_handler_1.AppError('Role with this name already exists', 409);
            }
            throw err;
        }
    }
    /**
     * Get role by ID
     */
    async getRoleById(roleId) {
        const row = await (0, db_1.default)('organization_roles')
            .where({ id: roleId })
            .first();
        return row ? this.roleFromRow(row) : null;
    }
    /**
     * Get all roles for an organization
     */
    async getOrganizationRoles(organizationId, roleType) {
        let query = (0, db_1.default)('organization_roles')
            .where({ organization_id: organizationId, is_active: true })
            .orderBy('role_name');
        if (roleType) {
            query = query.where('role_type', roleType);
        }
        const rows = await query;
        return rows.map((r) => this.roleFromRow(r));
    }
    /**
     * Add a member to a role
     */
    async addMember(request) {
        try {
            const [row] = await (0, db_1.default)('organization_role_members')
                .insert({
                role_id: request.roleId,
                user_id: request.userId,
                added_by: request.addedBy,
                is_active: true,
            })
                .returning('*');
            logger_1.logger.info('[ORG_ROLE] Member added', {
                roleId: request.roleId,
                userId: request.userId,
            });
            return this.memberFromRow(row);
        }
        catch (err) {
            if (err.code === '23505') { // Unique violation
                throw new error_handler_1.AppError('User is already a member of this role', 409);
            }
            throw err;
        }
    }
    /**
     * Remove a member from a role
     */
    async removeMember(roleId, userId) {
        await (0, db_1.default)('organization_role_members')
            .where({ role_id: roleId, user_id: userId })
            .update({ is_active: false });
        logger_1.logger.info('[ORG_ROLE] Member removed', { roleId, userId });
    }
    /**
     * Get members of a specific role
     */
    async getRoleMembers(roleId) {
        const rows = await (0, db_1.default)('organization_role_members')
            .where({ role_id: roleId, is_active: true })
            .select('user_id');
        return rows.map((r) => r.user_id);
    }
    /**
     * Get all executive members in an organization
     */
    async getExecutiveMembers(organizationId) {
        const rows = await (0, db_1.default)('organization_role_members')
            .join('organization_roles', 'organization_roles.id', 'organization_role_members.role_id')
            .where({
            'organization_roles.organization_id': organizationId,
            'organization_roles.role_type': 'EXECUTIVE',
            'organization_roles.is_active': true,
            'organization_role_members.is_active': true,
        })
            .select('organization_role_members.user_id')
            .distinct();
        return rows.map((r) => r.user_id);
    }
    /**
     * Get all committee members for a specific committee role
     */
    async getCommitteeMembers(roleId) {
        return this.getRoleMembers(roleId);
    }
    /**
     * Get all members of an organization
     */
    async getAllOrgMembers(organizationId) {
        const rows = await (0, db_1.default)('memberships')
            .where({ organization_id: organizationId, is_active: true })
            .select('user_id');
        return rows.map((r) => r.user_id);
    }
    /**
     * Resolve participants based on visibility type.
     * This is the core function for determining who should be invited.
     */
    async resolveParticipants(organizationId, visibilityType, options) {
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
                    throw new error_handler_1.AppError('Committee ID required for COMMITTEE visibility', 400);
                }
                // Verify committee exists and belongs to org
                const role = await this.getRoleById(committeeId);
                if (!role || role.organizationId !== organizationId) {
                    throw new error_handler_1.AppError('Committee not found in organization', 404);
                }
                if (role.roleType !== 'COMMITTEE') {
                    throw new error_handler_1.AppError('Specified role is not a committee', 400);
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
                    throw new error_handler_1.AppError('Participant list required for CUSTOM visibility', 400);
                }
                // Validate all participants are org members
                const orgMembers = await this.getAllOrgMembers(organizationId);
                const orgMemberSet = new Set(orgMembers);
                const validParticipants = customParticipants.filter(id => orgMemberSet.has(id));
                if (validParticipants.length === 0) {
                    throw new error_handler_1.AppError('No valid organization members in participant list', 400);
                }
                return {
                    userIds: validParticipants,
                    count: validParticipants.length,
                    visibilityType,
                };
            }
            default:
                throw new error_handler_1.AppError(`Unknown visibility type: ${visibilityType}`, 400);
        }
    }
    /**
     * Check if a user belongs to a specific role type in an organization
     */
    async userHasRoleType(userId, organizationId, roleType) {
        const row = await (0, db_1.default)('organization_role_members')
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
    async userIsRoleMember(userId, roleId) {
        const row = await (0, db_1.default)('organization_role_members')
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
    async getUserRoles(userId, organizationId) {
        const rows = await (0, db_1.default)('organization_roles')
            .join('organization_role_members', 'organization_roles.id', 'organization_role_members.role_id')
            .where({
            'organization_roles.organization_id': organizationId,
            'organization_roles.is_active': true,
            'organization_role_members.user_id': userId,
            'organization_role_members.is_active': true,
        })
            .select('organization_roles.*');
        return rows.map((r) => this.roleFromRow(r));
    }
    // ── Row Converters ──────────────────────────────────────────
    roleFromRow(row) {
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
    memberFromRow(row) {
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
exports.organizationRoleService = new OrganizationRoleService();
//# sourceMappingURL=organization-role.service.js.map