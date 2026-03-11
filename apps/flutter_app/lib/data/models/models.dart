// Core data models for OrgsLedger.
// Uses simple immutable classes with fromJson / toJson.

class User {
  final String id;
  final String email;
  final String? firstName;
  final String? lastName;
  final String? avatarUrl;
  final bool emailVerified;
  final String? phone;
  final List<Membership> memberships;

  const User({
    required this.id,
    required this.email,
    this.firstName,
    this.lastName,
    this.avatarUrl,
    this.emailVerified = false,
    this.phone,
    this.memberships = const [],
  });

  String get displayName {
    if (firstName != null && lastName != null) return '$firstName $lastName';
    if (firstName != null) return firstName!;
    return email.split('@').first;
  }

  String get initials {
    final parts = displayName.split(' ');
    if (parts.length >= 2) {
      return '${parts[0][0]}${parts[1][0]}'.toUpperCase();
    }
    return displayName
        .substring(0, displayName.length >= 2 ? 2 : 1)
        .toUpperCase();
  }

  factory User.fromJson(Map<String, dynamic> json) => User(
    id: json['id'] ?? '',
    email: json['email'] ?? '',
    firstName: json['first_name'] ?? json['firstName'],
    lastName: json['last_name'] ?? json['lastName'],
    avatarUrl: json['avatar_url'] ?? json['avatarUrl'],
    emailVerified: json['email_verified'] ?? json['emailVerified'] ?? false,
    phone: json['phone'],
    memberships:
        (json['memberships'] as List<dynamic>?)
            ?.map((m) => Membership.fromJson(m))
            .toList() ??
        [],
  );

  Map<String, dynamic> toJson() => {
    'id': id,
    'email': email,
    'firstName': firstName,
    'lastName': lastName,
    'avatarUrl': avatarUrl,
    'emailVerified': emailVerified,
    'phone': phone,
  };
}

class Membership {
  final String id;
  final String organizationId;
  final String orgName;
  final String role;
  final String? orgSlug;
  final String? orgLogoUrl;

  const Membership({
    required this.id,
    required this.organizationId,
    required this.orgName,
    required this.role,
    this.orgSlug,
    this.orgLogoUrl,
  });

  bool get isAdmin =>
      role == 'org_admin' || role == 'executive' || role == 'super_admin';

  factory Membership.fromJson(Map<String, dynamic> json) => Membership(
    id: json['id'] ?? '',
    organizationId: json['organization_id'] ?? json['organizationId'] ?? '',
    orgName:
        json['organizationName'] ??
        json['org_name'] ??
        json['organization_name'] ??
        json['orgName'] ??
        json['name'] ??
        '',
    role: json['role'] ?? 'member',
    orgSlug: json['organizationSlug'] ?? json['org_slug'] ?? json['orgSlug'],
    orgLogoUrl: json['logoUrl'] ?? json['org_logo_url'] ?? json['orgLogoUrl'],
  );
}

class Organization {
  final String id;
  final String name;
  final String? slug;
  final String? logoUrl;
  final String? description;
  final String? currency;
  final int memberCount;

  const Organization({
    required this.id,
    required this.name,
    this.slug,
    this.logoUrl,
    this.description,
    this.currency,
    this.memberCount = 0,
  });

  factory Organization.fromJson(Map<String, dynamic> json) => Organization(
    id: json['id'] ?? '',
    name: json['name'] ?? '',
    slug: json['slug'],
    logoUrl: json['logo_url'] ?? json['logoUrl'],
    description: json['description'],
    currency: json['currency'] ?? 'USD',
    memberCount: json['member_count'] ?? json['memberCount'] ?? 0,
  );
}

class ChatChannel {
  final String id;
  final String name;
  final String type; // general, committee, dm
  final int unreadCount;
  final String? lastMessage;
  final String? lastMessageAt;

  const ChatChannel({
    required this.id,
    required this.name,
    required this.type,
    this.unreadCount = 0,
    this.lastMessage,
    this.lastMessageAt,
  });

  factory ChatChannel.fromJson(Map<String, dynamic> json) => ChatChannel(
    id: json['id'] ?? '',
    name: json['name'] ?? '',
    type: json['type'] ?? 'general',
    unreadCount: json['unread_count'] ?? json['unreadCount'] ?? 0,
    lastMessage: json['last_message'] ?? json['lastMessage'],
    lastMessageAt: json['last_message_at'] ?? json['lastMessageAt'],
  );
}

class ChatMessage {
  final String id;
  final String channelId;
  final String userId;
  final String? userName;
  final String content;
  final String? parentId;
  final String createdAt;
  final List<dynamic> attachments;

  const ChatMessage({
    required this.id,
    required this.channelId,
    required this.userId,
    this.userName,
    required this.content,
    this.parentId,
    required this.createdAt,
    this.attachments = const [],
  });

  factory ChatMessage.fromJson(Map<String, dynamic> json) {
    // Build userName from senderFirstName/senderLastName if user_name not present
    String? userName = json['user_name'] ?? json['userName'];
    if (userName == null || userName.isEmpty) {
      final first = json['senderFirstName'] ?? json['sender_first_name'];
      final last = json['senderLastName'] ?? json['sender_last_name'];
      if (first != null) {
        userName = last != null ? '$first $last' : first.toString();
      }
    }
    return ChatMessage(
      id: json['id'] ?? '',
      channelId: json['channel_id'] ?? json['channelId'] ?? '',
      userId:
          json['sender_id'] ??
          json['senderId'] ??
          json['user_id'] ??
          json['userId'] ??
          '',
      userName: userName,
      content: json['content'] ?? '',
      parentId:
          json['parent_id'] ??
          json['parentId'] ??
          json['thread_id'] ??
          json['threadId'],
      createdAt: json['created_at'] ?? json['createdAt'] ?? '',
      attachments: json['attachments'] ?? [],
    );
  }
}

class Poll {
  final String id;
  final String title;
  final String? description;
  final String status; // active, closed
  final List<PollOption> options;
  final String createdAt;

  const Poll({
    required this.id,
    required this.title,
    this.description,
    this.status = 'active',
    this.options = const [],
    required this.createdAt,
  });

  factory Poll.fromJson(Map<String, dynamic> json) => Poll(
    id: json['id'] ?? '',
    title: json['title'] ?? '',
    description: json['description'],
    status: json['status'] ?? 'active',
    options:
        (json['options'] as List<dynamic>?)
            ?.map((o) => PollOption.fromJson(o))
            .toList() ??
        [],
    createdAt: json['created_at'] ?? json['createdAt'] ?? '',
  );
}

class PollOption {
  final String id;
  final String text;
  final int voteCount;
  final bool hasVoted;

  const PollOption({
    required this.id,
    required this.text,
    this.voteCount = 0,
    this.hasVoted = false,
  });

  factory PollOption.fromJson(Map<String, dynamic> json) => PollOption(
    id: json['id'] ?? '',
    text: json['text'] ?? json['option'] ?? '',
    voteCount: json['vote_count'] ?? json['voteCount'] ?? 0,
    hasVoted: json['has_voted'] ?? json['hasVoted'] ?? false,
  );
}

class AppNotification {
  final String id;
  final String type;
  final String title;
  final String? body;
  final bool isRead;
  final String createdAt;
  final Map<String, dynamic>? data;

  const AppNotification({
    required this.id,
    required this.type,
    required this.title,
    this.body,
    this.isRead = false,
    required this.createdAt,
    this.data,
  });

  factory AppNotification.fromJson(Map<String, dynamic> json) =>
      AppNotification(
        id: json['id'] ?? '',
        type: json['type'] ?? '',
        title: json['title'] ?? '',
        body: json['body'] ?? json['message'],
        isRead: json['is_read'] ?? json['isRead'] ?? json['read'] ?? false,
        createdAt: json['created_at'] ?? json['createdAt'] ?? '',
        data: json['data'],
      );
}

class AppEvent {
  final String id;
  final String title;
  final String? description;
  final String? location;
  final String startDate;
  final String? endDate;
  final int rsvpCount;
  final bool hasRsvpd;

  const AppEvent({
    required this.id,
    required this.title,
    this.description,
    this.location,
    required this.startDate,
    this.endDate,
    this.rsvpCount = 0,
    this.hasRsvpd = false,
  });

  factory AppEvent.fromJson(Map<String, dynamic> json) => AppEvent(
    id: json['id'] ?? '',
    title: json['title'] ?? '',
    description: json['description'],
    location: json['location'],
    startDate: json['start_date'] ?? json['startDate'] ?? '',
    endDate: json['end_date'] ?? json['endDate'],
    rsvpCount: json['rsvp_count'] ?? json['rsvpCount'] ?? 0,
    hasRsvpd: json['has_rsvpd'] ?? json['hasRsvpd'] ?? false,
  );
}

class FinancialTransaction {
  final String id;
  final String type; // due, fine, donation, expense
  final String description;
  final double amount;
  final String currency;
  final String status; // pending, paid, overdue
  final String createdAt;
  final String? dueDate;

  const FinancialTransaction({
    required this.id,
    required this.type,
    required this.description,
    required this.amount,
    this.currency = 'USD',
    this.status = 'pending',
    required this.createdAt,
    this.dueDate,
  });

  factory FinancialTransaction.fromJson(Map<String, dynamic> json) =>
      FinancialTransaction(
        id: json['id'] ?? '',
        type: json['type'] ?? '',
        description: json['description'] ?? json['title'] ?? '',
        amount: (json['amount'] is num)
            ? (json['amount'] as num).toDouble()
            : double.tryParse(json['amount']?.toString() ?? '0') ?? 0,
        currency: json['currency'] ?? 'USD',
        status: json['status'] ?? 'pending',
        createdAt: json['created_at'] ?? json['createdAt'] ?? '',
        dueDate: json['due_date'] ?? json['dueDate'],
      );
}
