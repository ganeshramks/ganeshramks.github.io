$(document).ready(function(){
	
	$("#apple-contact").hide();
	$("#windows-contact").hide();
	$("#hangout").show();
	
	intro = [];
	intro[0] = { "content" : "Mapping the World with Cartesian Blocks;", "classname" : "hello0" };
	intro[1] = { "content" : "Hello There!", "classname" : "hello1" };
	intro[2] = { "content" : "My name is Ganesh Ram.", "classname" : "hello2" };
	
	var l = 0;
	var k = 0;
	
	function type(){
		if (l < intro.length && k < intro[l].content.length) {
			ele = document.getElementsByClassName(intro[l].classname)[0];
			ele.style.display = "inline-block";
			ele.innerHTML += intro[l].content[k];
			ele.style.borderRight = "solid orange";
			k++;
			setTimeout(type, 150);
		} else {
			if (l < intro.length) {
				ele.style.borderRight = "none";
				ele.style.display = "block";
				l++;
				k = 0;
				type();
			} else {
				ele.style.display = "inline-block";
				ele.style.borderRight = "solid orange";
			}
		}
	}

	type();

	$("#entrochef").click(function(){
		$("#entrochef-modal").modal('show');
	});
	
	$("#1").click(function(){
		$('#selfie-modal').modal('show');
	});
		
	$("#2").click(function(){
		$('#smart-modal').modal('show');
	});
		
	$("#3").click(function(){
		$('#e-yantra-modal').modal('show');
	});

	$("#smart-charge-card").click(function(){
		$('#smart-charge').modal('show');
	});

	$("#4").click(function(){
		$('#robometry-modal').modal('show');
	});
	$("#5").click(function(){
		$("#isquare-modal").modal('show');
	});
	$("#6").click(function(){
		$("#pravaah-modal").modal('show');
	});
	$("#7").click(function(){
		$("#sponsorship-modal").modal('show');
	});
	$("#8").click(function(){
		$("#junkyard-modal").modal('show');
	});
	$("#CRIITR").click(function(){
		$("#criitr-modal").modal('show');
	});

	var news_papers = ["the-hindu.jpeg", "young-world-the-hindu.jpeg", "bangalore-vijay-times.jpeg", "times-of-india.jpeg", "deccan-herald.jpeg", "vijay-karnataka.jpeg"];

	img_url_prefix = "assets/img/newspaper/";

	for (var i = 0; i < news_papers.length; i++) {
		selector = '#news_paper_' +	(i + 1);
		$(selector).width('100%').height('100%').attr('src', img_url_prefix + news_papers[i]);
	}

	//Apple and Windows Contact
	var apple = navigator.platform.match(/(Mac|iPhone|iPod|iPad)/i)?true:false;
	var windows = navigator.platform.match(/(Win)/i)?true:false;
	if (apple) {
		$("#apple-contact").show();
		$("#windows-contact").hide();
	}
	if (windows) {
		$("#apple-contact").hide();
		$("#windows-contact").show();
	}

	//Hangout Contact
	
	$.ajax({
		url : "https://apis.google.com/js/platform.js",
		dataType : "script",
		async : true,
		success : function(){
			gapi.hangout.render('hangout-div', {
				'render' : 'createhangout',
				'invites' : [{
					'id' : 'ganeshram997@gmail.com',
					'invite_type' : 'EMAIL'
				}]
			});
		}
	});

});