-- Same opt-in-to-opt-out flip as 0097 (skills profile sharing), applied to
-- the two remaining cross-user visibility defaults: connections seeing your
-- activity feed, and being discoverable in skill search by anyone tracking
-- the same skill (not just existing connections). Existing accounts are
-- included, not just new signups -- every row currently at the old default
-- is flipped. As with 0097, a row already at a non-default value (an
-- explicit past choice, including 'selective' for skill search) is left
-- alone, since a plain UPDATE can't tell "never touched" apart from
-- "deliberately set back to the old default" -- both look identical.
alter table profiles alter column activity_feed_visible set default true;
update profiles set activity_feed_visible = true where activity_feed_visible = false;

alter table profiles alter column skill_search_visibility set default 'all';
update profiles set skill_search_visibility = 'all' where skill_search_visibility = 'hidden';
