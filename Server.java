import com.sun.net.httpserver.HttpExchange;
import com.sun.net.httpserver.HttpHandler;
import com.sun.net.httpserver.HttpServer;

import java.io.*;
import java.net.InetSocketAddress;
import java.nio.charset.StandardCharsets;
import java.nio.file.*;
import java.time.LocalDateTime;
import java.time.LocalTime;
import java.time.format.DateTimeFormatter;
import java.util.*;

public class Server {
    private static final String CSV_FILE = "performances.csv";
    private static final String CSV_HEADER = "id,title,date,time,location,status,earnings,expenses,profit";

    public static void main(String[] args) throws IOException {
        initCSV();
        HttpServer server = HttpServer.create(new InetSocketAddress(8080), 0);

        server.createContext("/api/performances", new PerformanceHandler());
        server.createContext("/", new StaticFileHandler());

        server.setExecutor(null);
        System.out.println("Artist Tracker Server running at http://localhost:8080");
        server.start();
    }

    private static void initCSV() throws IOException {
        Path path = Paths.get(CSV_FILE);
        if (!Files.exists(path)) {
            Files.write(path, (CSV_HEADER + "\n").getBytes(StandardCharsets.UTF_8));
        }
    }

    private static String normalize12HourTime(String rawTime) {
        if (rawTime == null) return "05:00 PM";
        String cleaned = rawTime.trim().toUpperCase();
        try {
            if (cleaned.endsWith("AM") || cleaned.endsWith("PM")) {
                DateTimeFormatter inFmt = DateTimeFormatter.ofPattern("h:mm a", Locale.ENGLISH);
                LocalTime lt = LocalTime.parse(cleaned, inFmt);
                return lt.format(DateTimeFormatter.ofPattern("hh:mm a", Locale.ENGLISH));
            } else {
                LocalTime lt = LocalTime.parse(cleaned, DateTimeFormatter.ofPattern("H:mm"));
                return lt.format(DateTimeFormatter.ofPattern("hh:mm a", Locale.ENGLISH));
            }
        } catch (Exception e) {
            throw new IllegalArgumentException("Invalid time format. Expected format like 08:15 AM.");
        }
    }

    private static String computeStatus(String dateStr, String time12h) {
        try {
            String normalized = normalize12HourTime(time12h);
            DateTimeFormatter fmt = DateTimeFormatter.ofPattern("yyyy-MM-dd hh:mm a", Locale.ENGLISH);
            LocalDateTime showDateTime = LocalDateTime.parse(dateStr + " " + normalized, fmt);
            return showDateTime.isAfter(LocalDateTime.now()) ? "Upcoming" : "Completed";
        } catch (Exception e) {
            return "Completed";
        }
    }

    static class StaticFileHandler implements HttpHandler {
        @Override
        public void handle(HttpExchange exchange) throws IOException {
            String path = exchange.getRequestURI().getPath();
            if (path.equals("/")) path = "/index.html";

            File file = new File("frontend" + path);
            if (!file.exists() || file.isDirectory()) {
                String response = "404 Not Found";
                exchange.sendResponseHeaders(404, response.length());
                try (OutputStream os = exchange.getResponseBody()) {
                    os.write(response.getBytes());
                }
                return;
            }

            String contentType = "text/html";
            if (path.endsWith(".css")) contentType = "text/css";
            else if (path.endsWith(".js")) contentType = "application/javascript";

            exchange.getResponseHeaders().set("Content-Type", contentType);
            byte[] bytes = Files.readAllBytes(file.toPath());
            exchange.sendResponseHeaders(200, bytes.length);
            try (OutputStream os = exchange.getResponseBody()) {
                os.write(bytes);
            }
        }
    }

    static class PerformanceHandler implements HttpHandler {
        @Override
        public void handle(HttpExchange exchange) throws IOException {
            exchange.getResponseHeaders().add("Access-Control-Allow-Origin", "*");
            exchange.getResponseHeaders().add("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS");
            exchange.getResponseHeaders().add("Access-Control-Allow-Headers", "Content-Type");

            if ("OPTIONS".equalsIgnoreCase(exchange.getRequestMethod())) {
                exchange.sendResponseHeaders(204, -1);
                return;
            }

            String method = exchange.getRequestMethod();
            try {
                if ("GET".equalsIgnoreCase(method)) {
                    handleGet(exchange);
                } else if ("POST".equalsIgnoreCase(method)) {
                    handlePost(exchange);
                } else if ("PUT".equalsIgnoreCase(method)) {
                    handlePut(exchange);
                } else if ("DELETE".equalsIgnoreCase(method)) {
                    handleDelete(exchange);
                } else {
                    sendResponse(exchange, 405, "{\"error\":\"Method not allowed\"}");
                }
            } catch (IllegalArgumentException e) {
                sendResponse(exchange, 400, "{\"error\":\"" + e.getMessage() + "\"}");
            } catch (Exception e) {
                e.printStackTrace();
                sendResponse(exchange, 500, "{\"error\":\"Internal Server Error\"}");
            }
        }

        private void handleGet(HttpExchange exchange) throws IOException {
            List<String> lines = Files.readAllLines(Paths.get(CSV_FILE), StandardCharsets.UTF_8);
            StringBuilder json = new StringBuilder("[");
            boolean first = true;
            for (int i = 1; i < lines.size(); i++) {
                String line = lines.get(i).trim();
                if (line.isEmpty()) continue;
                String[] cols = line.split(",");
                if (cols.length < 9) continue;

                String liveStatus = computeStatus(cols[2], cols[3]);

                if (!first) json.append(",");
                json.append(String.format(
                    "{\"id\":\"%s\",\"title\":\"%s\",\"date\":\"%s\",\"time\":\"%s\",\"location\":\"%s\",\"status\":\"%s\",\"earnings\":%s,\"expenses\":%s,\"profit\":%s}",
                    escapeJson(cols[0]), escapeJson(cols[1]), escapeJson(cols[2]), escapeJson(cols[3]),
                    escapeJson(cols[4]), liveStatus, cols[6], cols[7], cols[8]
                ));
                first = false;
            }
            json.append("]");
            sendResponse(exchange, 200, json.toString());
        }

        private void handlePost(HttpExchange exchange) throws IOException {
            Map<String, String> data = parseSimpleJson(readBody(exchange));
            validateInput(data);

            String id = UUID.randomUUID().toString().substring(0, 8);
            String date = data.get("date");
            String time = normalize12HourTime(data.get("time"));
            String status = computeStatus(date, time);

            double earnings = "Upcoming".equals(status) ? 0.0 : parseMoney(data.get("earnings"));
            double expenses = "Upcoming".equals(status) ? 0.0 : parseMoney(data.get("expenses"));
            double profit = earnings - expenses;

            String newRow = String.format("%s,%s,%s,%s,%s,%s,%.2f,%.2f,%.2f\n",
                id, cleanCSV(data.get("title")), cleanCSV(date),
                cleanCSV(time), cleanCSV(data.get("location")), status,
                earnings, expenses, profit
            );

            Files.write(Paths.get(CSV_FILE), newRow.getBytes(StandardCharsets.UTF_8), StandardOpenOption.APPEND);
            sendResponse(exchange, 201, "{\"message\":\"Record added\",\"id\":\"" + id + "\"}");
        }

        private void handlePut(HttpExchange exchange) throws IOException {
            Map<String, String> data = parseSimpleJson(readBody(exchange));
            String targetId = data.get("id");
            if (targetId == null || targetId.isEmpty()) throw new IllegalArgumentException("Missing record ID");
            validateInput(data);

            String date = data.get("date");
            String time = normalize12HourTime(data.get("time"));
            String status = computeStatus(date, time);

            double earnings = "Upcoming".equals(status) ? 0.0 : parseMoney(data.get("earnings"));
            double expenses = "Upcoming".equals(status) ? 0.0 : parseMoney(data.get("expenses"));
            double profit = earnings - expenses;

            List<String> lines = Files.readAllLines(Paths.get(CSV_FILE), StandardCharsets.UTF_8);
            List<String> updated = new ArrayList<>();
            updated.add(CSV_HEADER);
            boolean found = false;

            for (int i = 1; i < lines.size(); i++) {
                String[] cols = lines.get(i).split(",");
                if (cols.length >= 9 && cols[0].equals(targetId)) {
                    updated.add(String.format("%s,%s,%s,%s,%s,%s,%.2f,%.2f,%.2f",
                        targetId, cleanCSV(data.get("title")), cleanCSV(date),
                        cleanCSV(time), cleanCSV(data.get("location")), status,
                        earnings, expenses, profit
                    ));
                    found = true;
                } else if (!lines.get(i).trim().isEmpty()) {
                    updated.add(lines.get(i));
                }
            }

            if (!found) throw new IllegalArgumentException("Record not found");
            Files.write(Paths.get(CSV_FILE), updated, StandardCharsets.UTF_8);
            sendResponse(exchange, 200, "{\"message\":\"Record updated\"}");
        }

        private void handleDelete(HttpExchange exchange) throws IOException {
            String query = exchange.getRequestURI().getQuery();
            if (query == null || !query.startsWith("id=")) {
                throw new IllegalArgumentException("Missing id parameter");
            }
            String targetId = query.substring(3);

            List<String> lines = Files.readAllLines(Paths.get(CSV_FILE), StandardCharsets.UTF_8);
            List<String> updated = new ArrayList<>();
            updated.add(CSV_HEADER);

            for (int i = 1; i < lines.size(); i++) {
                String[] cols = lines.get(i).split(",");
                if (cols.length > 0 && !cols[0].equals(targetId) && !lines.get(i).trim().isEmpty()) {
                    updated.add(lines.get(i));
                }
            }

            Files.write(Paths.get(CSV_FILE), updated, StandardCharsets.UTF_8);
            sendResponse(exchange, 200, "{\"message\":\"Record deleted\"}");
        }

        private double parseMoney(String val) {
            if (val == null || val.trim().isEmpty()) return 0.0;
            double num = Double.parseDouble(val);
            if (num < 0) throw new IllegalArgumentException("Money values cannot be negative.");
            return num;
        }

        private void validateInput(Map<String, String> data) {
            String title = data.get("title");
            String date = data.get("date");
            String location = data.get("location");

            if (title == null || title.trim().isEmpty()) throw new IllegalArgumentException("Show title is required.");
            if (date == null || !date.matches("\\d{4}-\\d{2}-\\d{2}")) throw new IllegalArgumentException("Valid date (YYYY-MM-DD) is required.");
            if (location == null || location.trim().isEmpty()) throw new IllegalArgumentException("Location is required.");

            String normalizedTime = normalize12HourTime(data.get("time"));
            String status = computeStatus(date, normalizedTime);

            if ("Completed".equals(status)) {
                try {
                    parseMoney(data.get("earnings"));
                    parseMoney(data.get("expenses"));
                } catch (NumberFormatException ex) {
                    throw new IllegalArgumentException("Earnings and expenses must be valid numbers.");
                }
            }
        }

        private String readBody(HttpExchange exchange) throws IOException {
            try (BufferedReader br = new BufferedReader(new InputStreamReader(exchange.getRequestBody(), StandardCharsets.UTF_8))) {
                StringBuilder sb = new StringBuilder();
                String line;
                while ((line = br.readLine()) != null) sb.append(line);
                return sb.toString();
            }
        }

        private void sendResponse(HttpExchange exchange, int status, String response) throws IOException {
            exchange.getResponseHeaders().set("Content-Type", "application/json; charset=UTF-8");
            byte[] bytes = response.getBytes(StandardCharsets.UTF_8);
            exchange.sendResponseHeaders(status, bytes.length);
            try (OutputStream os = exchange.getResponseBody()) {
                os.write(bytes);
            }
        }

        private Map<String, String> parseSimpleJson(String json) {
            Map<String, String> map = new HashMap<>();
            json = json.trim();
            if (json.startsWith("{") && json.endsWith("}")) {
                json = json.substring(1, json.length() - 1);
                String[] pairs = json.split(",(?=(?:[^\"]*\"[^\"]*\")*[^\"]*$)");
                for (String pair : pairs) {
                    String[] kv = pair.split(":", 2);
                    if (kv.length == 2) {
                        String key = kv[0].trim().replaceAll("^\"|\"$", "");
                        String val = kv[1].trim().replaceAll("^\"|\"$", "");
                        map.put(key, val);
                    }
                }
            }
            return map;
        }

        private String cleanCSV(String val) {
            return val.replace(",", " ").replace("\n", " ").trim();
        }

        private String escapeJson(String val) {
            return val.replace("\"", "\\\"");
        }
    }
}
