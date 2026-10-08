import { Meeting } from "../models/Meeting.js";
import { Task } from "../models/Task.js";
import { success } from "../utils/apiResponse.js";

function minutesBetween(start, end) {
  if (!start || !end) return 0;
  return Math.max(0, (new Date(end) - new Date(start)) / 60000);
}

export const analyticsController = {
  async overview(req, res, next) {
    try {
      const filter = { owner: req.user._id, isDeleted: false };
      const [meetings, pendingTasks, completedTasks, overdueTasks] = await Promise.all([
        Meeting.find(filter).select("startTime endTime status recording aiAnalysis"),
        Task.countDocuments({ ...filter, status: { $ne: "COMPLETED" } }),
        Task.countDocuments({ ...filter, status: "COMPLETED" }),
        Task.countDocuments({ ...filter, status: { $ne: "COMPLETED" }, deadline: { $lt: new Date() } })
      ]);

      const recorded = meetings.filter((meeting) => meeting.recording?.filePath);
      const meetingMinutes = meetings.reduce((sum, meeting) => sum + minutesBetween(meeting.startTime, meeting.endTime), 0);
      const recordingSeconds = recorded.reduce((sum, meeting) => sum + (meeting.recording?.durationSeconds ?? 0), 0);

      // Meetings per month for the last six months, oldest first.
      const now = new Date();
      const byMonth = [];
      for (let offset = 5; offset >= 0; offset -= 1) {
        const start = new Date(now.getFullYear(), now.getMonth() - offset, 1);
        const end = new Date(now.getFullYear(), now.getMonth() - offset + 1, 1);
        const inMonth = meetings.filter((meeting) => meeting.startTime >= start && meeting.startTime < end);
        byMonth.push({
          month: start.toLocaleString(undefined, { month: "short", year: "2-digit" }),
          meetings: inMonth.length,
          recorded: inMonth.filter((meeting) => meeting.recording?.filePath).length
        });
      }

      const statusBreakdown = meetings.reduce((acc, meeting) => {
        acc[meeting.status] = (acc[meeting.status] ?? 0) + 1;
        return acc;
      }, {});

      success(res, {
        totalMeetings: meetings.length,
        recordedMeetings: recorded.length,
        analyzedMeetings: meetings.filter((meeting) => meeting.aiAnalysis?.status === "COMPLETED").length,
        totalMeetingHours: Number((meetingMinutes / 60).toFixed(2)),
        totalRecordingHours: Number((recordingSeconds / 3600).toFixed(2)),
        averageMeetingDuration: meetings.length ? Math.round(meetingMinutes / meetings.length) : 0,
        pendingTasks,
        completedTasks,
        overdueTasks,
        byMonth,
        statusBreakdown
      });
    } catch (error) {
      next(error);
    }
  }
};
