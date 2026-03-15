import { OrganizationRole, OrganizationRoleMember, MeetingVisibilityType, ResolvedParticipants, OrganizationRoleType } from '../models';
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
declare class OrganizationRoleService {
    /**
     * Create a new organization role
     */
    createRole(request: CreateRoleRequest): Promise<OrganizationRole>;
    /**
     * Get role by ID
     */
    getRoleById(roleId: string): Promise<OrganizationRole | null>;
    /**
     * Get all roles for an organization
     */
    getOrganizationRoles(organizationId: string, roleType?: OrganizationRoleType): Promise<OrganizationRole[]>;
    /**
     * Add a member to a role
     */
    addMember(request: AddMemberRequest): Promise<OrganizationRoleMember>;
    /**
     * Remove a member from a role
     */
    removeMember(roleId: string, userId: string): Promise<void>;
    /**
     * Get members of a specific role
     */
    getRoleMembers(roleId: string): Promise<string[]>;
    /**
     * Get all executive members in an organization
     */
    getExecutiveMembers(organizationId: string): Promise<string[]>;
    /**
     * Get all committee members for a specific committee role
     */
    getCommitteeMembers(roleId: string): Promise<string[]>;
    /**
     * Get all members of an organization
     */
    getAllOrgMembers(organizationId: string): Promise<string[]>;
    /**
     * Resolve participants based on visibility type.
     * This is the core function for determining who should be invited.
     */
    resolveParticipants(organizationId: string, visibilityType: MeetingVisibilityType, options?: {
        committeeId?: string;
        customParticipants?: string[];
    }): Promise<ResolvedParticipants>;
    /**
     * Check if a user belongs to a specific role type in an organization
     */
    userHasRoleType(userId: string, organizationId: string, roleType: OrganizationRoleType): Promise<boolean>;
    /**
     * Check if user is member of a specific role
     */
    userIsRoleMember(userId: string, roleId: string): Promise<boolean>;
    /**
     * Get all roles a user belongs to in an organization
     */
    getUserRoles(userId: string, organizationId: string): Promise<OrganizationRole[]>;
    private roleFromRow;
    private memberFromRow;
}
export declare const organizationRoleService: OrganizationRoleService;
export {};
//# sourceMappingURL=organization-role.service.d.ts.map