$(document).ready(function(){
	
	$("#apple-contact").hide();
	$("#windows-contact").hide();
	$("#hangout").show();

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