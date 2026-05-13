package main

import (
	"database/sql"
	"fmt"
	"log"

	_ "github.com/lib/pq"
)

func main() {
	dsn := "host=localhost port=5432 user=sub2api password=sub2api dbname=sub2api sslmode=disable"
	db, err := sql.Open("postgres", dsn)
	if err != nil {
		log.Fatal(err)
	}
	defer db.Close()

	fmt.Println("Group 2 Details:")
	rows, err := db.Query("SELECT id, name, config FROM groups WHERE id = 2")
	if err != nil {
		log.Fatal(err)
	}
	defer rows.Close()

	for rows.Next() {
		var id int64
		var name string
		var config sql.NullString
		if err := rows.Scan(&id, &name, &config); err != nil {
			log.Fatal(err)
		}
		fmt.Printf("ID=%d, Name=%s, Config=%s\n", id, name, config.String)
	}
}
