-- Sign-in compares a typed mailbox without regard to letter case.
CREATE INDEX creators_mailbox_lower ON creators (lower(mailbox));
CREATE INDEX invites_mailbox_lower ON invites (lower(mailbox));
