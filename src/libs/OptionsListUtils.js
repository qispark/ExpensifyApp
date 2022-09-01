/* eslint-disable no-continue */
import _ from 'underscore';
import Onyx from 'react-native-onyx';
import lodashGet from 'lodash/get';
import lodashOrderBy from 'lodash/orderBy';
import Str from 'expensify-common/lib/str';
import ONYXKEYS from '../ONYXKEYS';
import CONST from '../CONST';
import * as ReportUtils from './ReportUtils';
import * as Localize from './Localize';
import Permissions from './Permissions';
import * as CollectionUtils from './CollectionUtils';

/**
 * OptionsListUtils is used to build a list options passed to the OptionsList component. Several different UI views can
 * be configured to display different results based on the options passed to the private getOptions() method. Public
 * methods should be named for the views they build options for and then exported for use in a component.
 */

let currentUserLogin;
Onyx.connect({
    key: ONYXKEYS.SESSION,
    callback: val => currentUserLogin = val && val.email,
});

let loginList;
Onyx.connect({
    key: ONYXKEYS.LOGIN_LIST,
    callback: val => loginList = _.isEmpty(val) ? [] : val,
});

let countryCodeByIP;
Onyx.connect({
    key: ONYXKEYS.COUNTRY_CODE,
    callback: val => countryCodeByIP = val || 1,
});

let preferredLocale;
Onyx.connect({
    key: ONYXKEYS.NVP_PREFERRED_LOCALE,
    callback: val => preferredLocale = val || CONST.DEFAULT_LOCALE,
});

const policies = {};
Onyx.connect({
    key: ONYXKEYS.COLLECTION.POLICY,
    callback: (policy, key) => {
        if (!policy || !key || !policy.name) {
            return;
        }

        policies[key] = policy;
    },
});

const iouReports = {};
Onyx.connect({
    key: ONYXKEYS.COLLECTION.REPORT_IOUS,
    callback: (iouReport, key) => {
        if (!iouReport || !key || !iouReport.ownerEmail) {
            return;
        }

        iouReports[key] = iouReport;
    },
});

const lastReportActions = {};
Onyx.connect({
    key: ONYXKEYS.COLLECTION.REPORT_ACTIONS,
    callback: (actions, key) => {
        if (!key || !actions) {
            return;
        }
        const reportID = CollectionUtils.extractCollectionItemID(key);
        lastReportActions[reportID] = _.last(_.toArray(actions));
    },
});

/**
 * Adds expensify SMS domain (@expensify.sms) if login is a phone number and if it's not included yet
 *
 * @param {String} login
 * @return {String}
 */
function addSMSDomainIfPhoneNumber(login) {
    if (Str.isValidPhone(login) && !Str.isValidEmail(login)) {
        const smsLogin = login + CONST.SMS.DOMAIN;
        return smsLogin.includes('+') ? smsLogin : `+${countryCodeByIP}${smsLogin}`;
    }
    return login;
}

/**
 * Returns the personal details for an array of logins
 *
 * @param {Array} logins
 * @param {Object} personalDetails
 * @returns {Object} – keys of the object are emails, values are PersonalDetails objects.
 */
function getPersonalDetailsForLogins(logins, personalDetails) {
    const personalDetailsForLogins = {};
    _.each(logins, (login) => {
        let personalDetail = personalDetails[login];
        if (!personalDetail) {
            personalDetail = {
                login,
                displayName: Str.removeSMSDomain(login),
                avatar: ReportUtils.getDefaultAvatar(login),
            };
        }
        personalDetailsForLogins[login] = personalDetail;
    });
    return personalDetailsForLogins;
}

/**
 * Constructs a Set with all possible names (displayName, firstName, lastName, email) for all participants in a report,
 * to be used in isSearchStringMatch.
 *
 * @param {Array<Object>} personalDetailList
 * @return {Set<String>}
 */
function getParticipantNames(personalDetailList) {
    // We use a Set because `Set.has(value)` on a Set of with n entries is up to n (or log(n)) times faster than
    // `_.contains(Array, value)` for an Array with n members.
    const participantNames = new Set();
    _.each(personalDetailList, (participant) => {
        if (participant.login) {
            participantNames.add(participant.login.toLowerCase());
        }
        if (participant.firstName) {
            participantNames.add(participant.firstName.toLowerCase());
        }
        if (participant.lastName) {
            participantNames.add(participant.lastName.toLowerCase());
        }
        if (participant.displayName) {
            participantNames.add(participant.displayName.toLowerCase());
        }
    });
    return participantNames;
}

/**
 * A very optimized method to remove unique items from an array.
 * Taken from https://stackoverflow.com/a/9229821/9114791
 *
 * @param {Array} items
 * @returns {Array}
 */
function uniqFast(items) {
    const seenItems = {};
    const result = [];
    let j = 0;
    for (let i = 0; i < items.length; i++) {
        const item = items[i];
        if (seenItems[item] !== 1) {
            seenItems[item] = 1;
            result[j++] = item;
        }
    }
    return result;
}

/**
 * Returns a string with all relevant search terms.
 * Default should be serachable by policy/domain name but not by participants.
 *
 * @param {Object} report
 * @param {String} reportName
 * @param {Array} personalDetailList
 * @param {Boolean} isChatRoomOrPolicyExpenseChat
 * @return {String}
 */
function getSearchText(report, reportName, personalDetailList, isChatRoomOrPolicyExpenseChat) {
    let searchTerms = [];

    if (!isChatRoomOrPolicyExpenseChat) {
        for (let i = 0; i < personalDetailList.length; i++) {
            const personalDetail = personalDetailList[i];
            searchTerms = searchTerms.concat([personalDetail.displayName, personalDetail.login.replace(/\./g, '')]);
        }
    }
    if (report) {
        Array.prototype.push.apply(searchTerms, reportName.split(''));
        Array.prototype.push.apply(searchTerms, reportName.split(','));

        if (isChatRoomOrPolicyExpenseChat) {
            const chatRoomSubtitle = ReportUtils.getChatRoomSubtitle(report, policies);
            Array.prototype.push.apply(searchTerms, chatRoomSubtitle.split(''));
            Array.prototype.push.apply(searchTerms, chatRoomSubtitle.split(','));
        } else {
            searchTerms = searchTerms.concat(report.participants);
        }
    }

    const finalSearchTerms = uniqFast(searchTerms).join(' ');
    return finalSearchTerms;
}

/**
 * If the report or the report actions have errors, return
 * CONST.BRICK_ROAD_INDICATOR_STATUS.ERROR, otherwise an empty string.
 *
 * @param {Object} report
 * @param {Object} reportActions
 * @returns {String}
 */
function getBrickRoadIndicatorStatusForReport(report, reportActions) {
    const reportErrors = lodashGet(report, 'errors', {});
    const reportErrorFields = lodashGet(report, 'errorFields', {});
    const reportID = lodashGet(report, 'reportID');
    const reportsActions = lodashGet(reportActions, `${ONYXKEYS.COLLECTION.REPORT_ACTIONS}${reportID}`, {});

    const hasReportFieldErrors = _.some(reportErrorFields, fieldErrors => !_.isEmpty(fieldErrors));
    const hasReportActionErrors = _.some(reportsActions, action => !_.isEmpty(action.errors));

    if (_.isEmpty(reportErrors) && !hasReportFieldErrors && !hasReportActionErrors) {
        return '';
    }
    return CONST.BRICK_ROAD_INDICATOR_STATUS.ERROR;
}

/**
 * Creates a report list option
 *
 * @param {Array<String>} logins
 * @param {Object} personalDetails
 * @param {Object} report
 * @param {Object} reportActions
 * @param {Object} options
 * @param {Boolean} [options.showChatPreviewLine]
 * @param {Boolean} [options.forcePolicyNamePreview]
 * @returns {Object}
 */
function createOption(logins, personalDetails, report, reportActions = {}, {
    showChatPreviewLine = false,
    forcePolicyNamePreview = false,
}) {
    const result = {
        text: null,
        alternateText: null,
        brickRoadIndicator: null,
        icons: null,
        tooltipText: null,
        ownerEmail: null,
        subtitle: null,
        participantsList: null,
        login: null,
        reportID: null,
        phoneNumber: null,
        payPalMeAddress: null,
        isUnread: null,
        hasDraftComment: false,
        keyForList: null,
        searchText: null,
        isPinned: false,
        hasOutstandingIOU: false,
        iouReportID: null,
        isIOUReportOwner: null,
        iouReportAmount: 0,
        isChatRoom: false,
        isArchivedRoom: false,
        shouldShowSubscript: false,
        isPolicyExpenseChat: false,
    };

    const personalDetailMap = getPersonalDetailsForLogins(logins, personalDetails);
    const personalDetailList = _.values(personalDetailMap);
    const personalDetail = personalDetailList[0];
    let hasMultipleParticipants = personalDetailList.length > 1;
    let subtitle;

    if (report) {
        result.isChatRoom = ReportUtils.isChatRoom(report);
        result.isArchivedRoom = ReportUtils.isArchivedRoom(report);
        result.isPolicyExpenseChat = ReportUtils.isPolicyExpenseChat(report);
        result.shouldShowSubscript = result.isPolicyExpenseChat && !report.isOwnPolicyExpenseChat && !result.isArchivedRoom;
        result.brickRoadIndicator = getBrickRoadIndicatorStatusForReport(report, reportActions);
        result.ownerEmail = report.ownerEmail;
        result.reportID = report.reportID;
        result.isUnread = report.unreadActionCount > 0;
        result.hasDraftComment = report.hasDraft;
        result.isPinned = report.isPinned;
        result.iouReportID = report.iouReportID;
        result.keyForList = String(report.reportID);
        result.tooltipText = ReportUtils.getReportParticipantsTitle(report.participants || []);
        result.hasOutstandingIOU = report.hasOutstandingIOU;

        hasMultipleParticipants = personalDetailList.length > 1 || result.isChatRoom || result.isPolicyExpenseChat;
        subtitle = ReportUtils.getChatRoomSubtitle(report, policies);

        let lastMessageTextFromReport = '';
        if (ReportUtils.isReportMessageAttachment({text: report.lastMessageText, html: report.lastMessageHtml})) {
            lastMessageTextFromReport = `[${Localize.translateLocal('common.attachment')}]`;
        } else {
            lastMessageTextFromReport = Str.htmlDecode(report ? report.lastMessageText : '');
        }

        const lastActorDetails = personalDetailMap[report.lastActorEmail] || null;
        let lastMessageText = hasMultipleParticipants && lastActorDetails
            ? `${lastActorDetails.displayName}: `
            : '';
        lastMessageText += report ? lastMessageTextFromReport : '';

        if (result.isPolicyExpenseChat && result.isArchivedRoom) {
            const archiveReason = (lastReportActions[report.reportID] && lastReportActions[report.reportID].originalMessage && lastReportActions[report.reportID].originalMessage.reason)
                || CONST.REPORT.ARCHIVE_REASON.DEFAULT;
            lastMessageText = Localize.translate(preferredLocale, `reportArchiveReasons.${archiveReason}`, {
                displayName: archiveReason.displayName || report.lastActorEmail,
                policyName: ReportUtils.getPolicyName(report, policies),
            });
        }

        if (result.isChatRoom || result.isPolicyExpenseChat) {
            result.alternateText = (showChatPreviewLine && !forcePolicyNamePreview && lastMessageText)
                ? lastMessageText
                : subtitle;
        } else {
            result.alternateText = (showChatPreviewLine && lastMessageText)
                ? lastMessageText
                : Str.removeSMSDomain(personalDetail.login);
        }
    } else {
        result.keyForList = personalDetail.login;
    }

    if (result.hasOutstandingIOU) {
        const iouReport = iouReports[`${ONYXKEYS.COLLECTION.REPORT_IOUS}${report.iouReportID}`] || null;
        if (iouReport) {
            result.isIOUReportOwner = iouReport.ownerEmail === currentUserLogin;
            result.iouReportAmount = iouReport.total;
        }
    }

    if (!hasMultipleParticipants) {
        result.login = personalDetail.login;
        result.phoneNumber = personalDetail.phoneNumber;
        result.payPalMeAddress = personalDetail.payPalMeAddress;
    }

    const reportName = ReportUtils.getReportName(report, personalDetailMap, policies);
    result.text = reportName;
    result.subtitle = subtitle;
    result.participantsList = personalDetailList;
    result.icons = ReportUtils.getIcons(report, personalDetails, policies, personalDetail.avatar);
    result.searchText = getSearchText(report, reportName, personalDetailList, result.isChatRoom || result.isPolicyExpenseChat);

    return result;
}

/**
 * Searches for a match when provided with a value
 *
 * @param {String} searchValue
 * @param {String} searchText
 * @param {Set<String>} [participantNames]
 * @param {Boolean} isChatRoom
 * @returns {Boolean}
 */
function isSearchStringMatch(searchValue, searchText, participantNames = new Set(), isChatRoom = false) {
    const searchWords = _.map(
        searchValue
            .replace(/\./g, '')
            .replace(/,/g, ' ')
            .split(' '),
        word => word.trim(),
    );
    return _.every(searchWords, (word) => {
        const matchRegex = new RegExp(Str.escapeForRegExp(word), 'i');
        const valueToSearch = searchText && searchText.replace(new RegExp(/&nbsp;/g), '');
        return matchRegex.test(valueToSearch) || (!isChatRoom && participantNames.has(word));
    });
}

/**
 * Returns the given userDetails is currentUser or not.
 * @param {Object} userDetails
 * @returns {Boolean}
 */

function isCurrentUser(userDetails) {
    if (!userDetails) {
        // If userDetails is null or undefined
        return false;
    }

    // If user login is mobile number, append sms domain if not appended already.
    const userDetailsLogin = addSMSDomainIfPhoneNumber(userDetails.login);

    // Initial check with currentUserLogin
    let result = currentUserLogin.toLowerCase() === userDetailsLogin.toLowerCase();
    let index = 0;

    // Checking userDetailsLogin against to current user login options.
    while (index < loginList.length && !result) {
        if (loginList[index].partnerUserID.toLowerCase() === userDetailsLogin.toLowerCase()) {
            result = true;
        }
        index++;
    }
    return result;
}

/**
 * Build the options
 *
 * @param {Object} reports
 * @param {Object} personalDetails
 * @param {String} activeReportID
 * @param {Object} options
 * @returns {Object}
 * @private
 */
function getOptions(reports, personalDetails, activeReportID, {
    reportActions = {},
    betas = [],
    selectedOptions = [],
    maxRecentReportsToShow = 0,
    excludeLogins = [],
    excludeChatRooms = false,
    includeMultipleParticipantReports = false,
    includePersonalDetails = false,
    includeRecentReports = false,
    prioritizePinnedReports = false,
    prioritizeDefaultRoomsInSearch = false,

    // When sortByReportTypeInSearch flag is true, recentReports will include the personalDetails options as well.
    sortByReportTypeInSearch = false,
    sortByLastMessageTimestamp = true,
    searchValue = '',
    showChatPreviewLine = false,
    showReportsWithNoComments = false,
    hideReadReports = false,
    sortByAlphaAsc = false,
    sortPersonalDetailsByAlphaAsc = true,
    forcePolicyNamePreview = false,
    prioritizeIOUDebts = false,
    prioritizeReportsWithDraftComments = false,
}) {
    let recentReportOptions = [];
    const pinnedReportOptions = [];
    let personalDetailsOptions = [];
    const iouDebtReportOptions = [];
    const draftReportOptions = [];

    const reportMapForLogins = {};
    let sortProperty = sortByLastMessageTimestamp
        ? ['lastMessageTimestamp']
        : ['lastVisitedTimestamp'];
    if (sortByAlphaAsc) {
        sortProperty = ['reportName'];
    }

    const sortDirection = [sortByAlphaAsc ? 'asc' : 'desc'];
    let orderedReports = lodashOrderBy(reports, sortProperty, sortDirection);

    // Move the archived Rooms to the last
    orderedReports = _.sortBy(orderedReports, report => ReportUtils.isArchivedRoom(report));

    const allReportOptions = [];
    _.each(orderedReports, (report) => {
        const isChatRoom = ReportUtils.isChatRoom(report);
        const isDefaultRoom = ReportUtils.isDefaultRoom(report);
        const isPolicyExpenseChat = ReportUtils.isPolicyExpenseChat(report);
        const logins = report.participants || [];

        // Report data can sometimes be incomplete. If we have no logins or reportID then we will skip this entry.
        const shouldFilterNoParticipants = _.isEmpty(logins) && !isChatRoom && !isDefaultRoom && !isPolicyExpenseChat;
        if (!report || !report.reportID || shouldFilterNoParticipants) {
            return;
        }

        const hasDraftComment = report.hasDraft || false;
        const iouReport = report.iouReportID && iouReports[`${ONYXKEYS.COLLECTION.REPORT_IOUS}${report.iouReportID}`];
        const iouReportOwner = report.hasOutstandingIOU && iouReport
            ? iouReport.ownerEmail
            : '';

        const reportContainsIOUDebt = iouReportOwner && iouReportOwner !== currentUserLogin;
        const shouldFilterReportIfEmpty = !showReportsWithNoComments && report.lastMessageTimestamp === 0

                // We make exceptions for defaultRooms and policyExpenseChats so we can immediately
                // highlight them in the LHN when they are created and have no messsages yet. We do
                // not give archived rooms this exception since they do not need to be higlihted.
                && !(!ReportUtils.isArchivedRoom(report) && (isDefaultRoom || isPolicyExpenseChat));

        const shouldFilterReportIfRead = hideReadReports && !ReportUtils.isUnread(report);
        const shouldFilterReport = shouldFilterReportIfEmpty || shouldFilterReportIfRead;
        if (report.reportID.toString() !== activeReportID.toString()
            && !report.isPinned
            && !hasDraftComment
            && shouldFilterReport
            && !reportContainsIOUDebt) {
            return;
        }

        if (isChatRoom && excludeChatRooms) {
            return;
        }

        // We create policy rooms for all policies, however we don't show them unless
        // - It's a free plan workspace
        // - The report includes guides participants (@team.expensify.com) for 1:1 Assigned
        if (!Permissions.canUseDefaultRooms(betas)
            && ReportUtils.isDefaultRoom(report)
            && ReportUtils.getPolicyType(report, policies) !== CONST.POLICY.TYPE.FREE
            && !ReportUtils.hasExpensifyGuidesEmails(logins)
        ) {
            return;
        }

        if (ReportUtils.isUserCreatedPolicyRoom(report) && !Permissions.canUsePolicyRooms(betas)) {
            return;
        }

        if (isPolicyExpenseChat && !Permissions.canUsePolicyExpenseChat(betas)) {
            return;
        }

        // Save the report in the map if this is a single participant so we can associate the reportID with the
        // personal detail option later. Individuals should not be associated with single participant
        // policyExpenseChats or chatRooms since those are not people.
        if (logins.length <= 1 && !isPolicyExpenseChat && !isChatRoom) {
            reportMapForLogins[logins[0]] = report;
        }
        const isSearchingSomeonesPolicyExpenseChat = !report.isOwnPolicyExpenseChat && searchValue !== '';
        allReportOptions.push(createOption(logins, personalDetails, report, reportActions, {
            showChatPreviewLine,
            forcePolicyNamePreview: isPolicyExpenseChat ? isSearchingSomeonesPolicyExpenseChat : forcePolicyNamePreview,
        }));
    });

    let allPersonalDetailsOptions = _.map(personalDetails, personalDetail => createOption(
        [personalDetail.login],
        personalDetails,
        reportMapForLogins[personalDetail.login],
        reportActions,
        {
            showChatPreviewLine,
            forcePolicyNamePreview,
        },
    ));

    if (sortPersonalDetailsByAlphaAsc) {
        // PersonalDetails should be ordered Alphabetically by default - https://github.com/Expensify/App/issues/8220#issuecomment-1104009435
        allPersonalDetailsOptions = lodashOrderBy(allPersonalDetailsOptions, [personalDetail => personalDetail.text.toLowerCase()], 'asc');
    }

    // Always exclude already selected options and the currently logged in user
    const loginOptionsToExclude = [...selectedOptions, {login: currentUserLogin}];

    _.each(excludeLogins, (login) => {
        loginOptionsToExclude.push({login});
    });

    if (includeRecentReports) {
        for (let i = 0; i < allReportOptions.length; i++) {
            // Stop adding options to the recentReports array when we reach the maxRecentReportsToShow value
            if (recentReportOptions.length > 0 && recentReportOptions.length === maxRecentReportsToShow) {
                break;
            }

            const reportOption = allReportOptions[i];

            // Skip if we aren't including multiple participant reports and this report has multiple participants
            if (!includeMultipleParticipantReports && !reportOption.login) {
                continue;
            }

            // Check the report to see if it has a single participant and if the participant is already selected
            if (reportOption.login && _.some(loginOptionsToExclude, option => option.login === reportOption.login)) {
                continue;
            }

            // Finally check to see if this option is a match for the provided search string if we have one
            const {searchText, participantsList, isChatRoom} = reportOption;
            const participantNames = getParticipantNames(participantsList);
            if (searchValue && !isSearchStringMatch(searchValue, searchText, participantNames, isChatRoom)) {
                continue;
            }

            // If the report is pinned and we are using the option to display pinned reports on top then we need to
            // collect the pinned reports so we can sort them alphabetically once they are collected. We want to skip
            // default archived rooms.
            if (prioritizePinnedReports && reportOption.isPinned
                && !(reportOption.isArchivedRoom && reportOption.isDefaultRoom)) {
                pinnedReportOptions.push(reportOption);
            } else if (prioritizeIOUDebts && reportOption.hasOutstandingIOU && !reportOption.isIOUReportOwner) {
                iouDebtReportOptions.push(reportOption);
            } else if (prioritizeReportsWithDraftComments && reportOption.hasDraftComment) {
                draftReportOptions.push(reportOption);
            } else {
                recentReportOptions.push(reportOption);
            }

            // Add this login to the exclude list so it won't appear when we process the personal details
            if (reportOption.login) {
                loginOptionsToExclude.push({login: reportOption.login});
            }
        }
    }

    // If we are prioritizing reports with draft comments, add them before the normal recent report options
    // and sort them by report name.
    if (prioritizeReportsWithDraftComments) {
        const sortedDraftReports = lodashOrderBy(draftReportOptions, ['text'], ['asc']);
        recentReportOptions = sortedDraftReports.concat(recentReportOptions);
    }

    // If we are prioritizing IOUs the user owes, add them before the normal recent report options and reports
    // with draft comments.
    if (prioritizeIOUDebts) {
        const sortedIOUReports = lodashOrderBy(iouDebtReportOptions, ['iouReportAmount'], ['desc']);
        recentReportOptions = sortedIOUReports.concat(recentReportOptions);
    }

    // If we are prioritizing our pinned reports then shift them to the front and sort them by report name
    if (prioritizePinnedReports) {
        const sortedPinnedReports = lodashOrderBy(pinnedReportOptions, ['text'], ['asc']);
        recentReportOptions = sortedPinnedReports.concat(recentReportOptions);
    }

    // If we are prioritizing default rooms in search, do it only once we started something
    if (prioritizeDefaultRoomsInSearch && searchValue !== '') {
        const reportsSplitByDefaultChatRoom = _.partition(recentReportOptions, option => option.isChatRoom);
        recentReportOptions = reportsSplitByDefaultChatRoom[0].concat(reportsSplitByDefaultChatRoom[1]);
    }

    if (includePersonalDetails) {
        // Next loop over all personal details removing any that are selectedUsers or recentChats
        _.each(allPersonalDetailsOptions, (personalDetailOption) => {
            if (_.some(loginOptionsToExclude, loginOptionToExclude => (
                loginOptionToExclude.login === personalDetailOption.login
            ))) {
                return;
            }
            const {searchText, participantsList, isChatRoom} = personalDetailOption;
            const participantNames = getParticipantNames(participantsList);
            if (searchValue && !isSearchStringMatch(searchValue, searchText, participantNames, isChatRoom)) {
                return;
            }
            personalDetailsOptions.push(personalDetailOption);
        });
    }

    let userToInvite = null;
    const noOptions = (recentReportOptions.length + personalDetailsOptions.length) === 0;
    const noOptionsMatchExactly = !_.find(personalDetailsOptions.concat(recentReportOptions), option => option.login === searchValue.toLowerCase());
    if (searchValue && (noOptions || noOptionsMatchExactly)
        && !isCurrentUser({login: searchValue})
        && _.every(selectedOptions, option => option.login !== searchValue)
        && ((Str.isValidEmail(searchValue) && !Str.isDomainEmail(searchValue)) || Str.isValidPhone(searchValue))
        && (!_.find(loginOptionsToExclude, loginOptionToExclude => loginOptionToExclude.login === addSMSDomainIfPhoneNumber(searchValue).toLowerCase()))
        && (searchValue !== CONST.EMAIL.CHRONOS || Permissions.canUseChronos(betas))
    ) {
        // If the phone number doesn't have an international code then let's prefix it with the
        // current user's international code based on their IP address.
        const login = (Str.isValidPhone(searchValue) && !searchValue.includes('+'))
            ? `+${countryCodeByIP}${searchValue}`
            : searchValue;
        userToInvite = createOption([login], personalDetails, null, reportActions, {
            showChatPreviewLine,
        });
        userToInvite.icons = [ReportUtils.getDefaultAvatar(login)];
    }

    // If we are prioritizing 1:1 chats in search, do it only once we started searching
    if (sortByReportTypeInSearch && searchValue !== '') {
        // When sortByReportTypeInSearch is true, recentReports will be returned with all the reports including personalDetailsOptions in the correct Order.
        recentReportOptions.push(...personalDetailsOptions);
        personalDetailsOptions = [];
        recentReportOptions = lodashOrderBy(recentReportOptions, [(option) => {
            if (option.isChatRoom || option.isArchivedRoom) {
                return 3;
            }
            if (!option.login) {
                return 2;
            }
            if (option.login.toLowerCase() !== searchValue.toLowerCase()) {
                return 1;
            }

            // When option.login is an exact match with the search value, returning 0 puts it at the top of the option list
            return 0;
        }], ['asc']);
    }

    return {
        personalDetails: personalDetailsOptions,
        recentReports: recentReportOptions,
        userToInvite,
    };
}

/**
 * Build the options for the Search view
 *
 * @param {Object} reports
 * @param {Object} personalDetails
 * @param {String} searchValue
 * @param {Array<String>} betas
 * @returns {Object}
 */
function getSearchOptions(
    reports,
    personalDetails,
    searchValue = '',
    betas,
) {
    return getOptions(reports, personalDetails, 0, {
        betas,
        searchValue: searchValue.trim(),
        includeRecentReports: true,
        includeMultipleParticipantReports: true,
        maxRecentReportsToShow: 0, // Unlimited
        prioritizePinnedReports: false,
        prioritizeDefaultRoomsInSearch: false,
        sortByReportTypeInSearch: true,
        showChatPreviewLine: true,
        showReportsWithNoComments: true,
        includePersonalDetails: true,
        forcePolicyNamePreview: true,
        prioritizeIOUDebts: false,
    });
}

/**
 * Build the IOUConfirmation options for showing MyPersonalDetail
 *
 * @param {Object} myPersonalDetail
 * @param {String} amountText
 * @returns {Object}
 */
function getIOUConfirmationOptionsFromMyPersonalDetail(myPersonalDetail, amountText) {
    return {
        text: myPersonalDetail.displayName,
        alternateText: myPersonalDetail.login,
        icons: [myPersonalDetail.avatar],
        descriptiveText: amountText,
        login: myPersonalDetail.login,
    };
}

/**
 * Build the IOUConfirmationOptions for showing participants
 *
 * @param {Array} participants
 * @param {String} amountText
 * @returns {Array}
 */
function getIOUConfirmationOptionsFromParticipants(
    participants, amountText,
) {
    return _.map(participants, participant => ({
        ...participant, descriptiveText: amountText,
    }));
}

/**
 * Build the options for the New Group view
 *
 * @param {Object} reports
 * @param {Object} personalDetails
 * @param {Array<String>} betas
 * @param {String} searchValue
 * @param {Array} selectedOptions
 * @param {Array} excludeLogins
 * @returns {Object}
 */
function getNewChatOptions(
    reports,
    personalDetails,
    betas = [],
    searchValue = '',
    selectedOptions = [],
    excludeLogins = [],
) {
    return getOptions(reports, personalDetails, 0, {
        betas,
        searchValue: searchValue.trim(),
        selectedOptions,
        excludeChatRooms: true,
        includeRecentReports: true,
        includePersonalDetails: true,
        maxRecentReportsToShow: 5,
        excludeLogins,
    });
}

/**
 * Build the options for the Workspace Member Invite view
 *
 * @param {Object} personalDetails
 * @param {Array<String>} betas
 * @param {String} searchValue
 * @param {Array} excludeLogins
 * @returns {Object}
 */
function getMemberInviteOptions(
    personalDetails,
    betas = [],
    searchValue = '',
    excludeLogins = [],
) {
    return getOptions([], personalDetails, 0, {
        betas,
        searchValue: searchValue.trim(),
        excludeDefaultRooms: true,
        includePersonalDetails: true,
        excludeLogins,
        sortPersonalDetailsByAlphaAsc: false,
    });
}

/**
 * Build the options for the Sidebar a.k.a. LHN
 *
 * @param {Object} reports
 * @param {Object} personalDetails
 * @param {Number} activeReportID
 * @param {String} priorityMode
 * @param {Array<String>} betas
 * @param {Object} reportActions
 * @returns {Object}
 */
function getSidebarOptions(reports, personalDetails, activeReportID, priorityMode, betas, reportActions) {
    let sideBarOptions = {
        prioritizeIOUDebts: true,
        prioritizeReportsWithDraftComments: true,
    };
    if (priorityMode === CONST.PRIORITY_MODE.GSD) {
        sideBarOptions = {
            hideReadReports: true,
            sortByAlphaAsc: true,
        };
    }

    return getOptions(reports, personalDetails, activeReportID, {
        betas,
        includeRecentReports: true,
        includeMultipleParticipantReports: true,
        maxRecentReportsToShow: 0, // Unlimited
        showChatPreviewLine: true,
        prioritizePinnedReports: true,
        ...sideBarOptions,
        reportActions,
    });
}

/**
 * Helper method that returns the text to be used for the header's message and title (if any)
 *
 * @param {Boolean} hasSelectableOptions
 * @param {Boolean} hasUserToInvite
 * @param {String} searchValue
 * @param {Boolean} [maxParticipantsReached]
 * @return {String}
 */
function getHeaderMessage(hasSelectableOptions, hasUserToInvite, searchValue, maxParticipantsReached = false) {
    if (maxParticipantsReached) {
        return Localize.translate(preferredLocale, 'common.maxParticipantsReached', {count: CONST.REPORT.MAXIMUM_PARTICIPANTS});
    }

    if (searchValue && CONST.REGEX.DIGITS_AND_PLUS.test(searchValue) && !Str.isValidPhone(searchValue)) {
        return Localize.translate(preferredLocale, 'messages.errorMessageInvalidPhone');
    }

    // Without a search value, it would be very confusing to see a search validation message.
    // Therefore, this skips the validation when there is no search value.
    if (searchValue && !hasSelectableOptions && !hasUserToInvite) {
        if (/^\d+$/.test(searchValue) && !Str.isValidPhone(searchValue)) {
            return Localize.translate(preferredLocale, 'messages.errorMessageInvalidPhone');
        }

        return Localize.translate(preferredLocale, 'common.noResultsFound');
    }

    return '';
}

/**
 * Returns the currency list for sections display
 *
 * @param {Object} currencyOptions
 * @param {String} searchValue
 * @returns {Array}
 */
function getCurrencyListForSections(currencyOptions, searchValue) {
    const filteredOptions = _.filter(currencyOptions, currencyOption => (
        isSearchStringMatch(searchValue, currencyOption.text)));

    return {
        // returns filtered options i.e. options with string match if search text is entered
        currencyOptions: filteredOptions,
    };
}

export {
    addSMSDomainIfPhoneNumber,
    isCurrentUser,
    getSearchOptions,
    getNewChatOptions,
    getMemberInviteOptions,
    getSidebarOptions,
    getHeaderMessage,
    getPersonalDetailsForLogins,
    getCurrencyListForSections,
    getIOUConfirmationOptionsFromMyPersonalDetail,
    getIOUConfirmationOptionsFromParticipants,
};
